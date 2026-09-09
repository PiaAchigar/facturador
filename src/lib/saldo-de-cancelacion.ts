/**
 * Cuánta plata queda a favor cuando se cancela una compra.
 *
 * **La regla, en una línea:** el saldo a favor es lo pagado MENOS lo que valen
 * las sesiones que ya se hicieron (decisión de Pia, 2026-09-09).
 *
 * El precio de la compra se reparte en partes iguales entre sus sesiones. Un
 * pack de $166.000 en 3 sesiones vale $55.333 por sesión; si se consumió una,
 * quedan $110.667 a favor.
 *
 * ⚠️ **Lo consumido se valúa al PRECIO, no a lo pagado.** Con el mínimo del 40%
 * una clienta puede haber pagado $66.400 y haberse hecho 2 sesiones que valen
 * $110.667. Repartir lo *pagado* entre las sesiones le devolvería $22.133 a
 * alguien que en realidad le debe plata al local. Se valúa lo entregado, y se
 * devuelve lo que sobró de lo que entró.
 *
 * Lógica pura, sin base de datos.
 */

export type CompraCancelada = {
  /** Lo efectivamente COBRADO. Sólo se puede dejar a favor lo que entró. */
  pagado: number;
  /** El precio de la compra, que es lo que valen las sesiones entregadas. */
  finalAmount: number;
  sessionsTotal: number;
  /** Sesiones con `consumed_at`. Las agendadas NO cuentan: no se hicieron. */
  consumidas: number;
};

/** Lo que vale una sesión de esta compra. */
export function valorDeUnaSesion(finalAmount: number, sessionsTotal: number): number {
  return sessionsTotal <= 0 ? 0 : finalAmount / sessionsTotal;
}

/**
 * El saldo a favor que deja una cancelación.
 *
 * Se redondea UNA sola vez, sobre lo consumido, y el crédito es el resto: así
 * nunca se acredita más de lo que entró por un peso de redondeo.
 *
 * **Nunca negativo.** Si se consumió más valor del que se pagó, el saldo es
 * cero. La deuda que quede es una conversación entre Laura y la clienta, no un
 * número escondido en el saldo a favor.
 */
export function saldoAAcreditar(compra: CompraCancelada): number {
  if (compra.pagado <= 0) return 0;
  // Sin sesiones cargadas no hay nada que prorratear: vuelve todo lo pagado. No
  // debería pasar (el modelo exige sessions_total > 0), pero quedarse con la
  // plata sería lo peor de las dos opciones.
  if (compra.sessionsTotal <= 0) return compra.pagado;

  const valorConsumido = Math.round(
    valorDeUnaSesion(compra.finalAmount, compra.sessionsTotal) * compra.consumidas,
  );
  return Math.max(0, compra.pagado - valorConsumido);
}
