/**
 * El estado de una compra y de sus sesiones.
 *
 * `customer_purchase_session` NO tiene columna de estado, y por eso no puede
 * desincronizarse: se deriva. Un turno cancelado devuelve la sesión a
 * *disponible* sin que nadie escriba nada — la condición deja de cumplirse.
 *
 * Lógica pura, sin base de datos.
 */

export type EstadoSesion = "consumida" | "agendada" | "vencida" | "disponible";

export type SesionCruda = {
  consumedAt: Date | null;
  appointmentId: string | null;
  /** El estado del turno. Un turno cancelado o ausente no reserva la sesión. */
  appointmentStatus: string | null;
};

export type VigenciaCompra = {
  expiresAt: Date | null;
  cancelledAt: Date | null;
};

/** Un turno cancelado o con ausente libera la sesión: nadie va a venir. */
const NO_RESERVA = new Set(["cancelled", "no_show"]);

/**
 * El orden importa y no es alfabético:
 *
 * 1. **Consumida** gana sobre todo. La sesión se usó cuando el pack estaba
 *    vigente; que hoy esté vencido no borra que se hizo.
 * 2. **Agendada** gana sobre vencida. El turno existe y alguien va a venir:
 *    decirle "vencida" haría que se la ignore y la clienta llegue a un turno
 *    que nadie esperaba.
 * 3. **Vencida** para lo que quedó sin usar, si el pack venció o se canceló.
 * 4. **Disponible** en cualquier otro caso.
 */
export function estadoDeSesion(
  sesion: SesionCruda,
  compra: VigenciaCompra,
  ahora: Date,
): EstadoSesion {
  if (sesion.consumedAt) return "consumida";

  const reservada =
    sesion.appointmentId != null && !NO_RESERVA.has(sesion.appointmentStatus ?? "");
  if (reservada) return "agendada";

  if (compra.cancelledAt) return "vencida";
  if (compra.expiresAt && compra.expiresAt < ahora) return "vencida";
  return "disponible";
}

export type ResumenCompra = {
  consumidas: number;
  agendadas: number;
  disponibles: number;
  vencidas: number;
  pagado: number;
  saldo: number;
  saldada: boolean;
};

/**
 * Los números de una compra: cuántas sesiones en cada estado, cuánto se pagó y
 * cuánto falta.
 *
 * `pagos` son los montos de los `payments` CONFIRMADOS de esta compra — el
 * saldo tiene una sola definición y es esta.
 */
export function resumenDeCompra(
  compra: { finalAmount: number } & VigenciaCompra,
  sesiones: readonly SesionCruda[],
  pagos: readonly number[],
  ahora: Date,
): ResumenCompra {
  const conteo = { consumida: 0, agendada: 0, vencida: 0, disponible: 0 };
  for (const s of sesiones) conteo[estadoDeSesion(s, compra, ahora)] += 1;

  const pagado = pagos.reduce((a, b) => a + b, 0);
  // Nunca negativo: un saldo negativo se leería como "hay que devolverle
  // plata", que es otra cosa y vive en el saldo a favor del cliente.
  const saldo = Math.max(0, compra.finalAmount - pagado);

  return {
    consumidas: conteo.consumida,
    agendadas: conteo.agendada,
    disponibles: conteo.disponible,
    vencidas: conteo.vencida,
    pagado,
    saldo,
    saldada: saldo === 0,
  };
}
