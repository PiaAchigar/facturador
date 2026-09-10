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

/**
 * Qué comprobantes hay que emitir al devolver plata de una factura.
 *
 * **Un comprobante con CAE no se acredita a medias** (regla de Pia,
 * 2026-09-11). Aunque se devuelva una parte, la nota de crédito va por el
 * TOTAL de la factura y lo que la clienta sí consumió se vuelve a facturar
 * aparte. Acreditar sólo lo devuelto dejaba viva una factura por un importe
 * que ya no era el de ninguna operación real.
 */
export type ComprobantesDeDevolucion = {
  /** Monto de la nota de crédito: siempre el total de la factura. */
  notaPor: number;
  /** Monto a refacturar. 0 si se devolvió todo. */
  refacturaPor: number;
};

export function comprobantesDeDevolucion(
  totalFacturado: number,
  montoDevueltoDeclarado: number,
): ComprobantesDeDevolucion {
  if (totalFacturado <= 0 || montoDevueltoDeclarado <= 0) {
    return { notaPor: 0, refacturaPor: 0 };
  }
  return {
    notaPor: totalFacturado,
    // Nunca negativo: devolver más de lo facturado no genera una refactura al
    // revés, simplemente no queda nada que volver a cobrar.
    refacturaPor: Math.max(0, totalFacturado - montoDevueltoDeclarado),
  };
}
