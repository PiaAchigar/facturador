/**
 * Qué pasa con la plata cuando se cancela una compra.
 *
 * **Son DOS cosas distintas y no hay que confundirlas** (Laura vía Pia,
 * 2026-09-09):
 *
 * - **Saldo a favor** — generoso. CUALQUIER plata que haya entrado queda a
 *   favor, seña incluida, para usarla en otro tratamiento. Es lo primero que
 *   se le ofrece a la clienta y es lo que evita sacar plata de la caja.
 * - **Devolución** — restrictivo. Sacar plata de la caja y dársela en la mano
 *   exige que la compra esté pagada al 100%.
 *
 * En las dos se descuenta lo mismo: las sesiones que ya se hicieron. La
 * diferencia está en la puerta de entrada, no en la cuenta.
 *
 * **Y la seña, ¿cuándo se pierde?** Cuando la clienta no vuelve. No hace falta
 * decidirlo al cancelar: el saldo a favor vence a los 3 meses y ahí pasa a
 * caja. Si en ese plazo cambia de tratamiento, lo usa; si no aparece, se
 * perdió. Laura no tiene que adivinar al momento de cancelar qué va a hacer la
 * clienta.
 *
 * Lógica pura, sin base de datos.
 */

export type CompraCancelada = {
  /** Lo efectivamente COBRADO. Sólo se puede dejar a favor lo que entró. */
  pagado: number;
  /** El precio de la compra. Define dos cosas: cuánto vale cada sesión
   *  entregada, y si el pago fue completo (que habilita la devolución). */
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
 * El saldo a favor que deja una cancelación: lo pagado menos lo que valen las
 * sesiones que ya se hicieron.
 *
 * Se aplica SIEMPRE, haya pagado una seña o todo. Una seña también es plata de
 * la clienta y le queda a favor por si quiere cambiar de tratamiento.
 *
 * Se redondea UNA sola vez, sobre lo consumido, y el crédito es el resto: así
 * nunca se acredita más de lo que entró por un peso de redondeo.
 *
 * **Nunca negativo.** Con el mínimo del 40% una clienta puede haberse hecho
 * sesiones que valen más de lo que pagó; ahí el saldo es cero. La deuda que
 * quede es una conversación entre Laura y la clienta, no un número escondido
 * en el saldo a favor.
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

/**
 * Si esta compra habilita DEVOLVER plata en mano.
 *
 * La condición es una sola: que esté pagada al 100%. Una seña no se devuelve
 * en efectivo — queda a favor, que es otra cosa. `>=` y no `===` porque si se
 * cobró de más, con más razón está paga.
 *
 * Lo que se devuelve es `saldoAAcreditar`: el mismo descuento por sesiones
 * consumidas. La puerta es distinta; la cuenta es la misma.
 */
export function puedeDevolverse(compra: Pick<CompraCancelada, "pagado" | "finalAmount">): boolean {
  return compra.pagado > 0 && compra.pagado >= compra.finalAmount;
}
