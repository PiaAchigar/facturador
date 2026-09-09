/**
 * Cuánto del saldo a favor se aplica a una compra nueva.
 *
 * Es la pieza que hace que la plata NO salga de la caja: cuando una clienta
 * cancela algo pagado, lo primero que se le ofrece es usar ese saldo en otro
 * tratamiento (decisión de Laura vía Pia, 2026-09-09). La devolución en
 * efectivo es el último recurso.
 *
 * Lógica pura, sin base de datos.
 */

export type PagoConSaldo = {
  /** Cuánto saldo se aplica a esta compra. */
  conSaldo: number;
  /** Lo que queda por cobrar por otro medio. */
  restaPagar: number;
  /** El saldo que le queda a la clienta después. */
  saldoDespues: number;
  /** Si el saldo alcanzó para toda la compra. */
  cubreTodo: boolean;
};

/**
 * El plan de pago.
 *
 * Dos topes, y los dos importan:
 *
 * - **No más que el saldo que hay.** Obvio, pero es lo que evita dejar el
 *   saldo en negativo si la pantalla manda un número viejo.
 * - **No más que el precio de la compra.** Aplicar $110.667 a una compra de
 *   $51.000 dejaría un pago de más que después habría que devolver. El
 *   sobrante se queda donde estaba, que es a favor de la clienta.
 *
 * Si el saldo no alcanza, **la venta no se rechaza**: se usa lo que hay y el
 * resto queda por cobrar. Rechazarla obligaría a Laura a hacer la cuenta a
 * mano para saber cuánto pedir.
 */
export function planDePagoConSaldo(input: {
  aPagar: number;
  saldoDisponible: number;
  /** Cuánto usar. Si no se dice, se usa todo el que entre. */
  usar?: number;
}): PagoConSaldo {
  const tope = Math.min(Math.max(0, input.saldoDisponible), Math.max(0, input.aPagar));
  const pedido = input.usar == null ? tope : Math.max(0, input.usar);
  const conSaldo = Math.min(pedido, tope);

  return {
    conSaldo,
    restaPagar: Math.max(0, input.aPagar - conSaldo),
    saldoDespues: Math.max(0, input.saldoDisponible - conSaldo),
    cubreTodo: conSaldo >= input.aPagar,
  };
}
