/**
 * Cuánta plata queda a favor cuando se cancela una compra.
 *
 * **Dos reglas, en orden (decisión de Laura vía Pia, 2026-09-09):**
 *
 * 1. **Las señas no se devuelven.** Si no pagó el 100%, lo que entregó era su
 *    compromiso de compra y lo pierde al echarse atrás. Es la razón de ser de
 *    la seña: sin esa consecuencia, reservar no cuesta nada y el local se come
 *    los huecos de agenda.
 * 2. **Si pagó el 100%, se descuenta lo que ya se hizo.** El precio se reparte
 *    en partes iguales entre las sesiones; las consumidas se cobran. Un pack de
 *    $166.000 en 3 sesiones con una consumida deja $110.667 a favor.
 *
 * La primera regla decide sola: alcanza con mirar cuánto pagó. Recién si pagó
 * todo hace falta contar sesiones.
 *
 * ⚠️ **Lo consumido se valúa al PRECIO, no a lo pagado.** Con `pagado >=
 * finalAmount` los dos números coinciden casi siempre, pero no cuando se cobró
 * de más: ahí repartir *lo pagado* cobraría las sesiones más caras de lo que
 * salen.
 *
 * Lógica pura, sin base de datos.
 */

export type CompraCancelada = {
  /** Lo efectivamente COBRADO. Sólo se puede dejar a favor lo que entró. */
  pagado: number;
  /** El precio de la compra. Define dos cosas: si el pago fue completo, y
   *  cuánto vale cada sesión entregada. */
  finalAmount: number;
  sessionsTotal: number;
  /** Sesiones con `consumed_at`. Las agendadas NO cuentan: no se hicieron. */
  consumidas: number;
};

/** Lo que vale una sesión de esta compra. */
export function valorDeUnaSesion(finalAmount: number, sessionsTotal: number): number {
  return sessionsTotal <= 0 ? 0 : finalAmount / sessionsTotal;
}

/** Si la compra está paga del todo. `>=` y no `===`: si se cobró de más, con
 *  más razón está paga. */
export function pagoCompleto(compra: Pick<CompraCancelada, "pagado" | "finalAmount">): boolean {
  return compra.pagado >= compra.finalAmount;
}

/**
 * El saldo a favor que deja una cancelación.
 *
 * Se redondea UNA sola vez, sobre lo consumido, y el crédito es el resto: así
 * nunca se acredita más de lo que entró por un peso de redondeo.
 *
 * **Nunca negativo.** Si se consumió todo, el saldo es cero.
 */
export function saldoAAcreditar(compra: CompraCancelada): number {
  if (compra.pagado <= 0) return 0;
  // Regla 1: era una seña. No vuelve.
  if (!pagoCompleto(compra)) return 0;
  // Sin sesiones cargadas no hay nada que prorratear: vuelve todo lo pagado. No
  // debería pasar (el modelo exige sessions_total > 0), pero quedarse con la
  // plata sería lo peor de las dos opciones.
  if (compra.sessionsTotal <= 0) return compra.pagado;

  const valorConsumido = Math.round(
    valorDeUnaSesion(compra.finalAmount, compra.sessionsTotal) * compra.consumidas,
  );
  return Math.max(0, compra.pagado - valorConsumido);
}
