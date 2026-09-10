/**
 * Cuánto de una devolución es plata declarada.
 *
 * **La devolución hereda lo que hizo el cobro** (regla de Pia, 2026-09-10).
 * Antes se marcaba SIEMPRE declarada, apoyada en que "esa plata ya se declaró
 * al cobrar" — y eso no siempre es cierto: un cobro sin factura entra como
 * recibo, no declarado. Devolverlo declarado dejaba la rendición del día con un
 * egreso declarado que ningún ingreso declarado compensaba.
 *
 * El reparto es proporcional porque una misma compra puede haberse cobrado
 * mitad con factura y mitad sin: si el 60% entró declarado, el 60% sale
 * declarado. Con un solo cobro —el caso normal— da 100% o 0%.
 *
 * Lógica pura, sin base de datos.
 */

export type CobroDeCompra = { amount: number; isDeclared: boolean | null };

export type RepartoDeDevolucion = {
  /** Va a la caja como egreso declarado y puede exigir nota de crédito. */
  declarado: number;
  /** Va a la caja como egreso no declarado. Ni ARCA se entera ni tiene por qué. */
  noDeclarado: number;
};

export function repartirDevolucion(monto: number, cobros: CobroDeCompra[]): RepartoDeDevolucion {
  if (monto <= 0) return { declarado: 0, noDeclarado: 0 };

  const total = cobros.reduce((a, p) => a + p.amount, 0);
  // Sin cobros no hay nada que heredar. Devolverlo como no declarado es lo
  // conservador: declarar de más un egreso ensucia la rendición.
  if (total <= 0) return { declarado: 0, noDeclarado: monto };

  const declaradoCobrado = cobros.filter((p) => p.isDeclared).reduce((a, p) => a + p.amount, 0);
  const declarado = Math.round((monto * declaradoCobrado) / total);

  // El resto por diferencia, nunca con un segundo redondeo: las dos partes
  // tienen que sumar EXACTAMENTE lo devuelto o la caja queda por uno o dos pesos.
  return { declarado, noDeclarado: monto - declarado };
}
