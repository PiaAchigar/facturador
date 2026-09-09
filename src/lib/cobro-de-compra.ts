/**
 * Cuánto se puede cobrar de una compra y cuánto hay que cobrar como mínimo.
 *
 * Regla 5.10 de `reglas_negocio.md`: **el primer pago de un pack o combo es
 * como mínimo el 40%** del total. No hay tope: puede pagar el 40%, el 70% o
 * todo de una. El mínimo se valida; cobrar más se acepta.
 *
 * El 40% es del PRIMER pago. Los siguientes saldan lo que quede, de a lo que
 * la clienta pueda: exigir el 40% en cada uno haría imposible cerrar una
 * compra a la que le faltan mil pesos.
 *
 * Lógica pura, sin base de datos.
 */

/** Mínimo del primer pago de un pack o combo (regla 5.10). */
export const MINIMO_PRIMER_PAGO = 0.4;

export type EstadoDeCobro = {
  /** Lo que falta cobrar. */
  pendiente: number;
  /** Lo mínimo que se puede cobrar ahora. */
  minimo: number;
  /** Lo que la pantalla propone: el total. */
  sugerido: number;
  /** Si todavía no se llegó al 40% acumulado. */
  faltaElMinimo: boolean;
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export function cobroDeCompra(compra: { finalAmount: number; yaPagado: number }): EstadoDeCobro {
  const pendiente = Math.max(0, compra.finalAmount - compra.yaPagado);

  // El mínimo es sobre el ACUMULADO, no sobre este pago.
  //
  // Mirarlo pago por pago tiene un agujero: aplicando primero un saldo a favor
  // de $1.000, el pago siguiente ya no sería "el primero" y el 40% se
  // esquivaría entero. Contra el acumulado, lo que falta para llegar al 40% es
  // lo que hay que cobrar, venga de donde venga lo ya pagado.
  const cuarentaPorCiento = Math.round(compra.finalAmount * MINIMO_PRIMER_PAGO);
  const minimo = Math.max(0, Math.min(pendiente, cuarentaPorCiento - compra.yaPagado));

  return { pendiente, minimo, sugerido: pendiente, faltaElMinimo: minimo > 0 };
}

/**
 * Los motivos por los que ese monto no se puede cobrar. Vacío = se puede.
 *
 * Un solo motivo por vez y en orden de gravedad: acá el que cobra está
 * escribiendo un número, y una lista de tres errores sobre un mismo campo
 * confunde más de lo que ayuda.
 */
export function razonesParaNoCobrar(
  monto: number,
  compra: { finalAmount: number; yaPagado: number },
): string[] {
  const estado = cobroDeCompra(compra);

  if (estado.pendiente <= 0) return ["esta compra ya está paga"];
  if (monto <= 0) return ["el monto tiene que ser mayor a cero"];
  if (monto > estado.pendiente) {
    // Cobrar de más dejaría un pago que después habría que devolver.
    return [`no se puede cobrar más de lo que falta (${pesos(estado.pendiente)})`];
  }
  if (monto < estado.minimo) {
    return [
      `el primer pago tiene que ser de al menos ${pesos(estado.minimo)} ` +
        `(el 40% de ${pesos(compra.finalAmount)})`,
    ];
  }
  return [];
}
