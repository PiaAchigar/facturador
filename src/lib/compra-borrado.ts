/**
 * Qué impide borrar una compra para siempre.
 *
 * **Borrar y cancelar no son lo mismo, y la diferencia importa.** Cancelar
 * registra un hecho: la compra existió y se dio de baja, así que queda en la
 * ficha, tachada. Borrar es para lo que nunca debió existir —una venta cargada
 * por error hace un minuto— y no deja rastro porque no hay nada que contar.
 *
 * Por eso sólo se borra cuando no cuelga nada: si hubo un cobro, una factura o
 * un turno, algo pasó de verdad y eso se cancela, no se borra.
 *
 * Lógica pura, sin base de datos. Mismo patrón que `categorias-borrado.ts`.
 */

export type ImpactoDeBorrado = {
  pagos: number;
  /** Suma de los pagos, para que el cartel diga cuánta plata hay en juego. */
  montoPagado: number;
  facturas: number;
  sesionesAgendadas: number;
  sesionesConsumidas: number;
  /** Movimientos de saldo a favor atados a esta compra (1.46.0). */
  movimientosDeSaldo: number;
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

/**
 * Los motivos por los que NO se puede borrar. Vacío = se puede.
 *
 * Se devuelven TODOS, no el primero: mostrar de a uno obliga a destrabar a
 * ciegas sin saber cuánto falta.
 */
export function razonesParaNoBorrarCompra(i: ImpactoDeBorrado): string[] {
  const motivos: string[] = [];

  if (i.pagos > 0) {
    motivos.push(
      `ya tiene ${i.pagos} ${i.pagos === 1 ? "pago cobrado" : "pagos cobrados"} por ${pesos(i.montoPagado)}`,
    );
  }
  if (i.facturas > 0) {
    motivos.push(
      `está facturada (${i.facturas} ${i.facturas === 1 ? "factura la incluye" : "facturas la incluyen"})`,
    );
  }
  if (i.sesionesAgendadas > 0) {
    motivos.push(
      `tiene ${i.sesionesAgendadas} ${i.sesionesAgendadas === 1 ? "sesión agendada" : "sesiones agendadas"} con turno`,
    );
  }
  if (i.sesionesConsumidas > 0) {
    motivos.push(
      `tiene ${i.sesionesConsumidas} ${i.sesionesConsumidas === 1 ? "sesión ya consumida" : "sesiones ya consumidas"}`,
    );
  }
  if (i.movimientosDeSaldo > 0) {
    // Borrarla dejaría el libro de saldo a favor con movimientos que apuntan a
    // una compra inexistente — y el FK de la 1.46.0 directamente lo impide.
    motivos.push("movió el saldo a favor de la clienta");
  }

  return motivos;
}
