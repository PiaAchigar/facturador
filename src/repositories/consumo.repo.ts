import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  appointments,
  comboService,
  customerPurchase,
  customerPurchaseSession,
} from "../db/schema";
import { conflict } from "../lib/errors";
import { type SesionDisponible, elegirSesion } from "../lib/eleccion-de-sesion";

/**
 * Lo que la clienta tiene a favor para un servicio, y qué se descontaría.
 *
 * Es la consulta que corre al abrir el turno nuevo, así que la condición de
 * "disponible" está escrita en SQL en vez de traer todo y filtrar en memoria:
 * una clienta con años de historia tiene muchas sesiones y casi ninguna libre.
 *
 * Espeja `estadoDeSesion()` de `lib/compras.ts` — que es la definición— para el
 * caso `disponible`:
 *
 *   sin consumir · sin turno vivo · la compra ni vencida ni cancelada
 *
 * ⚠️ Si esa función cambia, esta condición cambia con ella. Se duplica a
 * propósito y no se comparte porque una es TypeScript sobre filas ya traídas y
 * la otra es un WHERE; unificarlas obligaría a traer la historia entera.
 */
export async function sesionesDisponiblesPara(
  db: Db,
  customerId: string,
  serviceId: string,
  ahora: Date,
): Promise<SesionDisponible[]> {
  const filas = await db
    .select({
      sessionId: customerPurchaseSession.id,
      purchaseId: customerPurchase.id,
      descripcion: customerPurchase.description,
      sessionNumber: customerPurchaseSession.sessionNumber,
      venceEl: customerPurchase.expiresAt,
    })
    .from(customerPurchaseSession)
    .innerJoin(
      customerPurchase,
      eq(customerPurchase.id, customerPurchaseSession.customerPurchaseId),
    )
    .leftJoin(appointments, eq(appointments.id, customerPurchaseSession.appointmentId))
    .where(
      and(
        eq(customerPurchase.customerId, customerId),
        // La compra tiene que estar viva.
        isNull(customerPurchase.cancelledAt),
        or(
          isNull(customerPurchase.expiresAt),
          sql`${customerPurchase.expiresAt} >= ${ahora}`,
        ),
        // La sesión, libre: sin consumir y sin un turno que la reserve. Un
        // turno CANCELADO no reserva —se avisó, se reagenda— pero un `no_show`
        // sí la deja tomada: la clienta la perdió (reglas §3.8).
        isNull(customerPurchaseSession.consumedAt),
        or(
          isNull(customerPurchaseSession.appointmentId),
          eq(appointments.status, "cancelled"),
        ),
        // Que la compra cubra ESTE servicio.
        //
        // Los combos de DOS O MÁS servicios quedan afuera a propósito: son una
        // sola sesión que necesita dos turnos, y `customer_purchase_session`
        // tiene una sola columna `appointment_id`. Engancharle el primer turno
        // dejaría al segundo servicio sin dónde ir, en silencio. Entran cuando
        // llegue la migración que baja el enganche a
        // `customer_purchase_session_service` (V3b).
        or(
          eq(customerPurchase.serviceId, serviceId),
          and(
            sql`${customerPurchase.comboId} IS NOT NULL`,
            sql`EXISTS (
              SELECT 1 FROM ${comboService} cs
               WHERE cs.combo_id = ${customerPurchase.comboId}
                 AND cs.service_id = ${serviceId}
            )`,
            sql`(
              SELECT count(*) FROM ${comboService} cs2
               WHERE cs2.combo_id = ${customerPurchase.comboId}
            ) = 1`,
          ),
        ),
      ),
    );

  return filas.map((f) => ({
    sessionId: f.sessionId,
    purchaseId: f.purchaseId,
    descripcion: f.descripcion ?? "Compra sin descripción",
    sessionNumber: f.sessionNumber ?? 0,
    venceEl: f.venceEl,
  }));
}

/** Lo que la pantalla de turno nuevo necesita saber en una sola consulta. */
export async function queSeDescuenta(
  db: Db,
  customerId: string,
  serviceId: string,
  ahora: Date,
) {
  return elegirSesion(await sesionesDisponiblesPara(db, customerId, serviceId, ahora));
}

/**
 * Ata la sesión al turno recién creado. Falla si ya no está libre.
 *
 * El UPDATE trae la condición de "libre" adentro del WHERE y no en un SELECT
 * previo, y eso es lo que lo hace seguro: si dos personas agendan la misma
 * sesión al mismo tiempo, la segunda actualiza cero filas y se entera. Con un
 * SELECT y después un UPDATE, las dos verían la sesión libre y la segunda
 * pisaría a la primera — el pack quedaría con una sesión de más y nadie se
 * enteraría hasta que la clienta reclame.
 *
 * También valida que la sesión sea de ESTA clienta: un id de sesión ajeno,
 * mandado por error o a propósito, descontaría el pack de otra persona.
 */
export async function tomarSesion(
  db: Db,
  sessionId: string,
  ctx: { appointmentId: string; customerId: string; serviceId: string; ahora: Date },
): Promise<void> {
  const libres = await sesionesDisponiblesPara(db, ctx.customerId, ctx.serviceId, ctx.ahora);
  if (!libres.some((s) => s.sessionId === sessionId)) {
    throw conflict("Esa sesión ya no está disponible para descontar");
  }

  const tomadas = await db
    .update(customerPurchaseSession)
    .set({ appointmentId: ctx.appointmentId, updatedAt: new Date() })
    .where(
      and(
        eq(customerPurchaseSession.id, sessionId),
        isNull(customerPurchaseSession.consumedAt),
        // Sin turno, o con uno cancelado que ya no la reserva.
        or(
          isNull(customerPurchaseSession.appointmentId),
          sql`EXISTS (
            SELECT 1 FROM ${appointments} a
             WHERE a.id = ${customerPurchaseSession.appointmentId}
               AND a.status = 'cancelled'
          )`,
        ),
      ),
    )
    .returning({ id: customerPurchaseSession.id });

  if (tomadas.length === 0) {
    throw conflict("Esa sesión acaba de ser tomada por otro turno");
  }
}

/**
 * Marca consumida la sesión atada a este turno.
 *
 * Se llama cuando el turno pasa a `completed`. Es idempotente: si ya tenía
 * `consumed_at` no lo pisa, así que volver a completar un turno no mueve la
 * fecha original.
 *
 * **El ausente NO pasa por acá.** Una sesión perdida por `no_show` se deriva
 * del estado del turno (`estadoDeSesion` la devuelve como "perdida") y no se
 * escribe: así, si Laura se equivocó y corrige el turno, la sesión vuelve sola
 * a estar disponible sin que nadie tenga que deshacer nada.
 */
export async function consumirSesionDelTurno(
  db: Db,
  appointmentId: string,
  ahora: Date,
): Promise<void> {
  await db
    .update(customerPurchaseSession)
    .set({ consumedAt: ahora, updatedAt: new Date() })
    .where(
      and(
        eq(customerPurchaseSession.appointmentId, appointmentId),
        isNull(customerPurchaseSession.consumedAt),
      ),
    );
}
