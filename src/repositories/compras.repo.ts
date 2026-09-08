import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  appointments,
  customerPurchase,
  customerPurchaseSession,
  payments,
  promotions,
} from "../db/schema";
import { estadoDeSesion, resumenDeCompra, type EstadoSesion } from "../lib/compras";

const compraFields = {
  id: customerPurchase.id,
  customerId: customerPurchase.customerId,
  comboId: customerPurchase.comboId,
  serviceId: customerPurchase.serviceId,
  depilationComboId: customerPurchase.depilationComboId,
  description: customerPurchase.description,
  sessionsTotal: customerPurchase.sessionsTotal,
  baseAmount: customerPurchase.baseAmount,
  discountedAmount: customerPurchase.discountedAmount,
  promotionId: customerPurchase.promotionId,
  finalAmount: customerPurchase.finalAmount,
  purchasedAt: customerPurchase.purchasedAt,
  expiresAt: customerPurchase.expiresAt,
  cancelledAt: customerPurchase.cancelledAt,
  notes: customerPurchase.notes,
};

export type CompraInput = {
  customerId: string;
  /** Exactamente uno. Lo valida el CHECK de la base, y esto lo valida antes. */
  comboId?: string | null;
  serviceId?: string | null;
  depilationComboId?: string | null;
  description: string;
  sessionsTotal: number;
  baseAmount: number;
  discountedAmount: number;
  finalAmount: number;
  promotionId?: string | null;
  expiresAt?: Date | null;
  notes?: string | null;
};

const dec = (n: number) => String(n);

/**
 * Vende: crea la compra y sus N sesiones vacías, en UNA transacción.
 *
 * Las sesiones nacen con la compra y no cuando se agendan. Si se crearan al
 * agendar, "cuántas te quedan" habría que calcularlo restando, y una compra de
 * 6 sesiones sin ninguna agendada se vería igual que una de 0.
 */
export async function createCompra(db: Db, input: CompraInput) {
  const origenes = [input.comboId, input.serviceId, input.depilationComboId].filter(Boolean);
  if (origenes.length !== 1) {
    throw new Error("Una compra tiene exactamente un origen: combo, servicio o combo de depilación");
  }
  if (input.sessionsTotal < 1) throw new Error("La compra necesita al menos una sesión");

  return db.transaction(async (tx) => {
    const filas = await tx
      .insert(customerPurchase)
      .values({
        customerId: input.customerId,
        comboId: input.comboId ?? null,
        serviceId: input.serviceId ?? null,
        depilationComboId: input.depilationComboId ?? null,
        description: input.description,
        sessionsTotal: input.sessionsTotal,
        baseAmount: dec(input.baseAmount),
        discountedAmount: dec(input.discountedAmount),
        promotionId: input.promotionId ?? null,
        finalAmount: dec(input.finalAmount),
        purchasedAt: new Date(),
        expiresAt: input.expiresAt ?? null,
        notes: input.notes ?? null,
      })
      .returning(compraFields);

    const compra = filas[0]!;
    await tx.insert(customerPurchaseSession).values(
      Array.from({ length: input.sessionsTotal }, (_, i) => ({
        customerPurchaseId: compra.id,
        sessionNumber: i + 1,
      })),
    );
    return compra;
  });
}

export type SesionLeida = {
  id: string;
  sessionNumber: number | null;
  appointmentId: string | null;
  appointmentStart: Date | null;
  consumedAt: Date | null;
  estado: EstadoSesion;
};

/**
 * Las compras de una clienta, con sus sesiones y sus números.
 *
 * Trae las tres consultas de una y arma todo en memoria: hacerlo por compra
 * sería N+1 sobre la ficha de la clienta, que es la pantalla que más se abre.
 */
export async function listComprasDeCliente(db: Db, customerId: string, ahora = new Date()) {
  const compras = await db
    .select({ ...compraFields, promotionName: promotions.name })
    .from(customerPurchase)
    .leftJoin(promotions, eq(promotions.id, customerPurchase.promotionId))
    .where(eq(customerPurchase.customerId, customerId))
    .orderBy(desc(customerPurchase.purchasedAt));

  if (compras.length === 0) return [];
  const ids = compras.map((c) => c.id);

  const [sesiones, pagos] = await Promise.all([
    db
      .select({
        id: customerPurchaseSession.id,
        customerPurchaseId: customerPurchaseSession.customerPurchaseId,
        sessionNumber: customerPurchaseSession.sessionNumber,
        appointmentId: customerPurchaseSession.appointmentId,
        consumedAt: customerPurchaseSession.consumedAt,
        appointmentStatus: appointments.status,
        appointmentStart: appointments.appointmentStart,
      })
      .from(customerPurchaseSession)
      .leftJoin(appointments, eq(appointments.id, customerPurchaseSession.appointmentId))
      .where(inArray(customerPurchaseSession.customerPurchaseId, ids)),
    db
      .select({
        customerPurchaseId: payments.customerPurchaseId,
        amount: payments.amount,
      })
      .from(payments)
      .where(
        and(inArray(payments.customerPurchaseId, ids), eq(payments.status, "confirmed")),
      ),
  ]);

  return compras.map((c) => {
    const mias = sesiones.filter((s) => s.customerPurchaseId === c.id);
    const vigencia = { expiresAt: c.expiresAt, cancelledAt: c.cancelledAt };
    const resumen = resumenDeCompra(
      { finalAmount: Number(c.finalAmount), ...vigencia },
      mias,
      pagos.filter((p) => p.customerPurchaseId === c.id).map((p) => Number(p.amount)),
      ahora,
    );
    return {
      ...c,
      baseAmount: Number(c.baseAmount),
      discountedAmount: Number(c.discountedAmount),
      finalAmount: Number(c.finalAmount),
      ...resumen,
      sessions: mias
        .sort((a, b) => (a.sessionNumber ?? 0) - (b.sessionNumber ?? 0))
        .map((s): SesionLeida => ({
          id: s.id,
          sessionNumber: s.sessionNumber,
          appointmentId: s.appointmentId,
          appointmentStart: s.appointmentStart,
          consumedAt: s.consumedAt,
          estado: estadoDeSesion(s, vigencia, ahora),
        })),
    };
  });
}

/**
 * Cancela una compra. No borra: puede tener pagos y facturas colgando, y una
 * venta cancelada sigue siendo parte de la historia de la clienta.
 *
 * Las sesiones sin usar pasan solas a *vencida* — se deriva de `cancelledAt`.
 */
export async function cancelCompra(db: Db, id: string, motivo?: string | null) {
  const filas = await db
    .update(customerPurchase)
    .set({
      cancelledAt: new Date(),
      notes: motivo ?? undefined,
      updatedAt: new Date(),
    })
    // Sólo si no estaba cancelada: cancelar dos veces pisaría la fecha de la
    // primera, que es la que dice cuándo dejó de valer.
    .where(and(eq(customerPurchase.id, id), isNull(customerPurchase.cancelledAt)))
    .returning(compraFields);
  return filas[0] ?? null;
}
