import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  analyticsEvents,
  appointments,
  callLogs,
  contacts,
  conversations,
  customerCreditMovements,
  customers,
  deals,
  invoices,
  messages,
  payments,
  trainingEnrollments,
  trainingSubscriptions,
} from "../db/schema";
import { cashRegister } from "../db/schema";
import { lotesDeSaldo } from "../lib/vencimiento-de-saldo";
import {
  notasConAplazo,
  origenYAplazos,
  razonesParaNoAplazar,
} from "../lib/aplazo-de-vencimiento";

const customerSummary = {
  id: customers.id,
  contactId: customers.contactId,
  dni: customers.dni,
  cuit: customers.cuit,
  creditBalance: customers.creditBalance,
  name: contacts.name,
  phone: contacts.phone,
  email: contacts.email,
};

// Un cliente ARCHIVADO no se ofrece en ningún selector del sistema: ni para
// agendar, ni para facturar, ni para suscribir. Estas dos funciones son el único
// embudo — `GET /api/billing/customers` es el endpoint que consumen los cuatro
// frontends (agenda, dashboard, facturador y CRM), así que el filtro va acá y no
// repetido en cada pantalla.
//
// Las búsquedas puntuales por id (`getCustomerById`, `getCustomerByContactId`)
// NO filtran a propósito: una factura vieja de un cliente archivado tiene que
// seguir resolviendo su nombre. Archivar saca de las listas, no borra el pasado.
const notArchived = sql`${contacts.isArchived} IS NOT TRUE`;

export async function searchCustomers(db: Db, q: string, limit = 20) {
  const pattern = `%${q}%`;
  return db
    .select(customerSummary)
    .from(customers)
    .innerJoin(contacts, eq(contacts.id, customers.contactId))
    .where(
      and(
        notArchived,
        or(
          ilike(contacts.name, pattern),
          ilike(customers.dni, pattern),
          ilike(contacts.phone, pattern),
        ),
      ),
    )
    .limit(limit);
}

export async function getCustomerById(db: Pick<Db, "select">, id: string) {
  const rows = await db
    .select(customerSummary)
    .from(customers)
    .innerJoin(contacts, eq(contacts.id, customers.contactId))
    .where(eq(customers.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Igual que `getCustomerById` pero busca por CONTACT id en vez de CUSTOMER id —
 *  usar cuando lo único disponible es el `contactId` (ej: `deals.contactId`),
 *  que es una FK a `contacts`, no a `customers`. */
export async function getCustomerByContactId(db: Pick<Db, "select">, contactId: string) {
  const rows = await db
    .select(customerSummary)
    .from(customers)
    .innerJoin(contacts, eq(contacts.id, customers.contactId))
    .where(eq(customers.contactId, contactId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCustomerByDni(db: Db, dni: string) {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.dni, dni)))
    .limit(1);
  return rows[0] ?? null;
}

/** Alta rápida: crea CONTACT (status customer) + CUSTOMER en una transacción. */
export async function createQuickCustomer(
  db: Db,
  data: { name: string; dni: string; phone?: string; email?: string },
) {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        name: data.name,
        phone: data.phone ?? null,
        email: data.email ?? null,
        status: "customer",
        country: "AR",
        firstContactDate: new Date(),
        isArchived: false,
      })
      .returning({ id: contacts.id });

    const [customer] = await tx
      .insert(customers)
      .values({
        contactId: contact!.id,
        dni: data.dni,
        firstPurchaseDate: new Date(),
      })
      .returning({ id: customers.id });

    return { customerId: customer!.id, contactId: contact!.id };
  });
}

export async function listRecentCustomers(db: Db, limit = 20) {
  return db
    .select(customerSummary)
    .from(customers)
    .innerJoin(contacts, eq(contacts.id, customers.contactId))
    .where(notArchived)
    .orderBy(desc(customers.createdAt))
    .limit(limit);
}

/** Acredita `amount` al saldo a favor del cliente. Se llama dentro de la misma
 *  transacción que cancela el deal (ver appointments.service.ts). `sql` suma
 *  sobre el valor actual en la propia query — no hay condición de carrera entre
 *  leer y escribir el balance. */
export type CreditMovementReason =
  | "appointment_cancelled"
  /** Se canceló un pack/combo/servicio comprado y quedó a favor lo no usado. */
  | "purchase_cancelled"
  /** Se usó el saldo para comprar otro pack/combo/servicio. */
  | "purchase_paid_with_credit"
  /** Se le devolvió la plata en mano y salió de la caja. */
  | "refunded"
  /** Se le venció el plazo para usarlo y pasó a la caja del local. */
  | "expired"
  | "deposit_paid_with_credit"
  | "manual_adjustment";

type CreditContext = {
  reason: CreditMovementReason;
  /** Hasta cuándo se puede usar. Sólo tiene sentido al acreditar. */
  expiresAt?: Date | null;
  appointmentId?: string | null;
  paymentId?: string | null;
  customerPurchaseId?: string | null;
  notes?: string | null;
};

/** Acredita saldo y deja el movimiento en el historial (misma transacción). */
export async function creditCustomer(
  tx: Pick<Db, "update" | "insert">,
  customerId: string,
  amount: number,
  ctx: CreditContext = { reason: "appointment_cancelled" },
) {
  await tx
    .update(customers)
    .set({ creditBalance: sql`${customers.creditBalance} + ${amount}` })
    .where(eq(customers.id, customerId));
  await insertCreditMovement(tx, customerId, amount, ctx);
}

/**
 * Consume saldo a favor. Devuelve false si no alcanza.
 *
 * El `WHERE credit_balance >= amount` hace el descuento seguro ante carreras:
 * dos reservas simultáneas del mismo cliente se serializan por el lock de fila
 * de Postgres y la segunda no matchea, en vez de dejar el saldo en negativo.
 */
export async function debitCustomerCredit(
  tx: Pick<Db, "update" | "insert">,
  customerId: string,
  amount: number,
  ctx: CreditContext,
): Promise<boolean> {
  const rows = await tx
    .update(customers)
    .set({ creditBalance: sql`${customers.creditBalance} - ${amount}` })
    .where(
      and(eq(customers.id, customerId), sql`${customers.creditBalance} >= ${amount}`),
    )
    .returning({ id: customers.id });
  if (rows.length === 0) return false;
  await insertCreditMovement(tx, customerId, -amount, ctx);
  return true;
}

async function insertCreditMovement(
  tx: Pick<Db, "insert">,
  customerId: string,
  amount: number,
  ctx: CreditContext,
) {
  await tx.insert(customerCreditMovements).values({
    customerId,
    amount: amount.toFixed(2),
    reason: ctx.reason,
    appointmentId: ctx.appointmentId ?? null,
    paymentId: ctx.paymentId ?? null,
    customerPurchaseId: ctx.customerPurchaseId ?? null,
    expiresAt: ctx.expiresAt ?? null,
    notes: ctx.notes ?? null,
  });
}

/** Movimientos de saldo de un cliente, del más reciente al más viejo. */
export async function listCreditMovements(db: Db, customerId: string, limit = 20) {
  return db
    .select()
    .from(customerCreditMovements)
    .where(eq(customerCreditMovements.customerId, customerId))
    .orderBy(desc(customerCreditMovements.createdAt))
    .limit(limit);
}

// ── Borrado de un cliente (admin-only) ──────────────────────────────────────

/** Cuenta el historial de un cliente para decidir si se puede borrar.
 *
 *  Reglas de negocio 1.3: hard DELETE solo en registros SIN transacciones
 *  asociadas. Facturas, pagos, turnos, suscripciones e inscripciones son
 *  historial de negocio y bloquean el borrado — una factura emitida con CAE ya
 *  existe en ARCA y borrarla acá solo desincroniza el sistema.
 *
 *  Conversaciones, deals y logs son rastros de CRM sin valor fiscal ni
 *  contable: se borran junto con el cliente.
 *
 *  Recibe el CONTACT id porque es la clave que tiene la pantalla de Clientes;
 *  el customer se resuelve adentro y puede no existir. */
export async function getClientDeleteImpact(db: Db, contactId: string) {
  const customer = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.contactId, contactId))
    .limit(1);
  const customerId = customer[0]?.id;

  // Sin customer no hay historial de negocio posible: es un contacto que nunca
  // agendó ni compró.
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  const [inv, pay, appt, subs, enr, credit] = customerId
    ? await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(invoices)
          .where(eq(invoices.customerId, customerId)).then(n),
        db.select({ n: sql<number>`count(*)::int` }).from(payments)
          .where(eq(payments.customerId, customerId)).then(n),
        db.select({ n: sql<number>`count(*)::int` }).from(appointments)
          .where(eq(appointments.customerId, customerId)).then(n),
        db.select({ n: sql<number>`count(*)::int` }).from(trainingSubscriptions)
          .where(eq(trainingSubscriptions.customerId, customerId)).then(n),
        db.select({ n: sql<number>`count(*)::int` }).from(trainingEnrollments)
          .where(eq(trainingEnrollments.customerId, customerId)).then(n),
        // `customer_credit_movements.customer_id` es ON DELETE RESTRICT (1.25.0):
        // sin contarlo acá, el borrado pasaba el chequeo previo y recién moría
        // en el DELETE, con el mensaje genérico de violación de FK.
        db.select({ n: sql<number>`count(*)::int` }).from(customerCreditMovements)
          .where(eq(customerCreditMovements.customerId, customerId)).then(n),
      ])
    : [0, 0, 0, 0, 0, 0];

  const [conv, dealRows, calls, events] = await Promise.all([
    db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, contactId)),
    db.select({ id: deals.id }).from(deals).where(eq(deals.contactId, contactId)),
    db.select({ id: callLogs.id }).from(callLogs).where(eq(callLogs.contactId, contactId)),
    db.select({ id: analyticsEvents.id }).from(analyticsEvents).where(eq(analyticsEvents.contactId, contactId)),
  ]);

  const msgRows = conv.length
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(inArray(messages.conversationId, conv.map((r) => r.id)))
    : [];

  const parts: string[] = [];
  if (inv > 0) parts.push(`${inv} factura(s)`);
  if (pay > 0) parts.push(`${pay} pago(s)`);
  if (appt > 0) parts.push(`${appt} turno(s)`);
  if (subs > 0) parts.push(`${subs} suscripción(es)`);
  if (enr > 0) parts.push(`${enr} inscripción(es)`);
  if (credit > 0) parts.push(`${credit} movimiento(s) de saldo a favor`);

  return {
    blocked: parts.length > 0,
    blockReason:
      parts.length > 0
        ? `Tiene ${parts.join(", ")}. Archivalo en su lugar para no perder el historial.`
        : undefined,
    history: {
      invoices: inv,
      payments: pay,
      appointments: appt,
      subscriptions: subs,
      enrollments: enr,
      creditMovements: credit,
    },
    cascade: {
      conversations: conv.length,
      messages: msgRows[0]?.n ?? 0,
      deals: dealRows.length,
      callLogs: calls.length,
      analyticsEvents: events.length,
    },
  };
}

/**
 * Quiénes tienen saldo a favor VENCIDO, y cuánto.
 *
 * Trae el libro entero de cada cliente con saldo y lo reparte con
 * `lotesDeSaldo`: no alcanza con mirar las acreditaciones viejas, porque la
 * clienta pudo haber gastado parte y lo que gastó no vence.
 *
 * Sólo mira a los que hoy tienen saldo > 0: si el saldo es cero no hay nada
 * que vencer, por vieja que sea la acreditación.
 */
export async function listSaldosVencidos(db: Db, ahora = new Date()) {
  const conSaldo = await db
    .select({
      customerId: customers.id,
      nombre: contacts.name,
      contactId: contacts.id,
      creditBalance: customers.creditBalance,
    })
    .from(customers)
    .leftJoin(contacts, eq(contacts.id, customers.contactId))
    .where(sql`${customers.creditBalance} > 0`);

  if (conSaldo.length === 0) return [];

  const movimientos = await db
    .select({
      id: customerCreditMovements.id,
      customerId: customerCreditMovements.customerId,
      amount: customerCreditMovements.amount,
      createdAt: customerCreditMovements.createdAt,
      expiresAt: customerCreditMovements.expiresAt,
      notes: customerCreditMovements.notes,
    })
    .from(customerCreditMovements)
    .where(
      inArray(
        customerCreditMovements.customerId,
        conSaldo.map((c) => c.customerId),
      ),
    );

  const salida = [];
  for (const cliente of conSaldo) {
    const suyos = movimientos
      .filter((m) => m.customerId === cliente.customerId)
      .map((m) => ({
        id: m.id,
        amount: Number(m.amount),
        createdAt: m.createdAt ?? new Date(0),
        expiresAt: m.expiresAt,
        notes: m.notes,
      }));
    const estado = lotesDeSaldo(suyos, ahora);
    if (estado.vencido <= 0) continue;

    salida.push({
      customerId: cliente.customerId,
      contactId: cliente.contactId,
      nombre: cliente.nombre,
      vencido: estado.vencido,
      vigente: estado.vigente,
      // De dónde salió cada peso vencido. Es lo que hace entendible el
      // movimiento de caja meses después.
      // `original` además de `monto`: cuando la clienta gastó parte del lote,
      // los dos números no coinciden y el cartel mostraba sólo el segundo. Sin
      // el primero, "$80.000" de una cancelación de $100.000 no se puede
      // reconstruir mirando la pantalla.
      origenes: estado.lotesVencidos.map((l) => ({
        monto: l.restante,
        original: l.original,
        acreditadoEl: l.acreditadoEl,
        venceEl: l.venceEl,
        detalle: l.notes ?? null,
      })),
    });
  }
  return salida.sort((a, b) => b.vencido - a.vencido);
}

/**
 * Da por vencido el saldo de una clienta y lo pasa a la caja del local, EN UNA
 * SOLA transacción.
 *
 * El movimiento negativo en el libro es lo que evita cobrarlo dos veces: la
 * corrida siguiente lo ve como consumo y el lote deja de estar vencido.
 *
 * ⚠️ El movimiento de caja es un INGRESO del día de hoy, y hay una salvedad
 * contable que Laura decidió asumir (2026-09-09): esa plata YA entró a la caja
 * el día que la clienta pagó la compra original, y el sistema nunca la
 * descontó al cancelarla. Anotarla otra vez acá la cuenta dos veces en los
 * totales del año. Se hace igual porque Laura quiere ver el movimiento el día
 * que vence, con el detalle de dónde vino. Si algún día se quiere el número
 * contable puro, se saca este insert y el resto sigue funcionando igual.
 */
/**
 * El saldo a favor de UNA clienta, abierto en sus lotes.
 *
 * La ficha mostraba `credit_balance`, un número solo, que suma lo vigente con
 * lo vencido y no dice cuándo vence nada. Con la clienta en el mostrador eso no
 * alcanza para responderle "¿hasta cuándo tengo?".
 *
 * Devuelve los lotes VIVOS —los que todavía tienen plata—, vencidos y vigentes
 * en una sola lista ordenada del más viejo al más nuevo, que es el orden en el
 * que se van a gastar.
 */
export async function estadoDeSaldoDeCliente(db: Db, customerId: string, ahora = new Date()) {
  const movimientos = await db
    .select({
      id: customerCreditMovements.id,
      amount: customerCreditMovements.amount,
      createdAt: customerCreditMovements.createdAt,
      expiresAt: customerCreditMovements.expiresAt,
      notes: customerCreditMovements.notes,
    })
    .from(customerCreditMovements)
    .where(eq(customerCreditMovements.customerId, customerId));

  const estado = lotesDeSaldo(
    movimientos.map((m) => ({
      id: m.id,
      amount: Number(m.amount),
      createdAt: m.createdAt ?? new Date(0),
      expiresAt: m.expiresAt,
      notes: m.notes,
    })),
    ahora,
  );

  const aSalida = (l: (typeof estado.lotesVigentes)[number], vencido: boolean) => {
    const { origen, aplazos } = origenYAplazos(l.notes ?? null);
    return {
      id: l.id ?? null,
      monto: l.restante,
      original: l.original,
      acreditadoEl: l.acreditadoEl,
      venceEl: l.venceEl,
      vencido,
      detalle: origen,
      // El historial va aparte del origen: un lote aplazado tres veces se leía
      // como un chorizo donde no se encontraba de dónde salió la plata.
      aplazos,
    };
  };

  const lotes = [
    ...estado.lotesVencidos.map((l) => aSalida(l, true)),
    ...estado.lotesVigentes.map((l) => aSalida(l, false)),
  ].sort((a, b) => a.acreditadoEl.getTime() - b.acreditadoEl.getTime());

  return { vigente: estado.vigente, vencido: estado.vencido, total: estado.vigente + estado.vencido, lotes };
}

/**
 * Corre para adelante la fecha de vencimiento de una o varias acreditaciones.
 *
 * **No hay concepto nuevo**: aplazar es mover `expires_at`, la misma columna
 * que se estampa al acreditar. Por eso no hay migración — y por eso un saldo
 * aplazado vuelve a vencer solo cuando llega la fecha nueva.
 *
 * Valida que los movimientos sean DE ESA CLIENTA antes de tocarlos: los ids
 * vienen del navegador y sin este filtro alcanzaría con cambiar uno para
 * estirarle el vencimiento a cualquier otra.
 */
export async function aplazarVencimientos(
  db: Db,
  customerId: string,
  movimientoIds: string[],
  nuevaFecha: Date,
  motivo: string | null,
  ahora = new Date(),
): Promise<{ aplazados: number; nuevaFecha: Date } | { error: string }> {
  if (movimientoIds.length === 0) return { error: "No se eligió ningún saldo para aplazar." };

  const filas = await db
    .select({
      id: customerCreditMovements.id,
      amount: customerCreditMovements.amount,
      expiresAt: customerCreditMovements.expiresAt,
      notes: customerCreditMovements.notes,
    })
    .from(customerCreditMovements)
    .where(
      and(
        eq(customerCreditMovements.customerId, customerId),
        inArray(customerCreditMovements.id, movimientoIds),
      ),
    );

  if (filas.length !== movimientoIds.length) {
    return { error: "Alguno de esos saldos no es de esta clienta." };
  }

  for (const f of filas) {
    const razones = razonesParaNoAplazar(
      { venceEl: f.expiresAt, esAcreditacion: Number(f.amount) > 0 },
      nuevaFecha,
      ahora,
    );
    // Se corta con el primero: son todos motivos por los que la operación
    // entera no va, y aplazar la mitad dejaría a la clienta con dos plazos.
    if (razones.length > 0) return { error: razones[0]! };
  }

  await db.transaction(async (tx) => {
    for (const f of filas) {
      await tx
        .update(customerCreditMovements)
        .set({
          expiresAt: nuevaFecha,
          notes: notasConAplazo(f.notes, f.expiresAt, nuevaFecha, motivo),
        })
        .where(eq(customerCreditMovements.id, f.id));
    }
  });

  return { aplazados: filas.length, nuevaFecha };
}

export async function vencerSaldoDeCliente(
  db: Db,
  customerId: string,
  ahora = new Date(),
): Promise<{ monto: number; detalle: string } | null> {
  const vencidos = await listSaldosVencidos(db, ahora);
  const mio = vencidos.find((v) => v.customerId === customerId);
  if (!mio || mio.vencido <= 0) return null;

  const origen = mio.origenes
    .map((o) => o.detalle ?? "saldo a favor")
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");
  const detalle = `Saldo a favor vencido — ${mio.nombre ?? "cliente"} (${origen})`;

  await db.transaction(async (tx) => {
    const ok = await debitCustomerCredit(tx, customerId, mio.vencido, {
      reason: "expired",
      notes: detalle,
    });
    // Si el saldo cambió entre la lectura y esta línea (la clienta lo usó en
    // una compra), el WHERE no matchea y se cae todo. Sin esto quedaría un
    // ingreso de caja sin respaldo.
    if (!ok) throw new Error("El saldo cambió mientras se vencía. Probá de nuevo.");

    await tx.insert(cashRegister).values({
      amount: mio.vencido.toFixed(2),
      source: "other",
      description: detalle,
      // No es una venta nueva: es plata que ya estaba y quedó en la casa.
      isDeclared: false,
      status: "recorded",
      registrationDate: ahora,
    });
  });

  return { monto: mio.vencido, detalle };
}
