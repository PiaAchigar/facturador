/**
 * Qué se descuenta del stock al completar un turno.
 *
 * Lógica pura: decide, no escribe. La parte que toca la base vive en
 * `services/consumo.service.ts`.
 */

export type LineaAConsumir = {
  productId: string;
  name: string | null;
  /** Lo que dice la receta del servicio. */
  quantity: number;
  /** Lo que hay hoy. `null` = nadie lo contó todavía. */
  quantityInStock: number | null;
  isActive: boolean | null;
};

export type Descuento = {
  productId: string;
  name: string | null;
  quantity: number;
  stockAntes: number | null;
  stockDespues: number;
};

export type Omitido = { productId: string; name: string | null; motivo: "archivado" | "cantidad" };

export type PlanDeConsumo = {
  descontar: Descuento[];
  /** Los que quedan en negativo. No frenan nada: se avisa. */
  faltantes: Descuento[];
  omitidos: Omitido[];
};

/** `numeric(10,3)` en la base; redondear acá evita arrastrar 9.499999999. */
function tresDecimales(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Nunca bloquea. Si no alcanza, descuenta igual y el insumo queda en negativo
 * (decisión de Laura, 2026-09-08: bloquear un turno ya hecho por un dato de
 * inventario mal cargado le frena la caja). El número negativo es el dato real.
 *
 * Un insumo sin stock cargado se trata como 0: dejarlo en `null` haría que el
 * descuento no hiciera nada y toda la función sería mentira.
 *
 * Los archivados NO se descuentan: se archivan porque ya no se usan, y moverles
 * el stock sería mover el de algo que nadie compra. Se informan aparte para que
 * el silencio no parezca un olvido.
 */
export function planDeConsumo(receta: readonly LineaAConsumir[]): PlanDeConsumo {
  const descontar: Descuento[] = [];
  const omitidos: Omitido[] = [];

  for (const l of receta) {
    if (l.isActive === false) {
      omitidos.push({ productId: l.productId, name: l.name, motivo: "archivado" });
      continue;
    }
    if (!(l.quantity > 0)) {
      omitidos.push({ productId: l.productId, name: l.name, motivo: "cantidad" });
      continue;
    }
    const antes = l.quantityInStock;
    descontar.push({
      productId: l.productId,
      name: l.name,
      quantity: l.quantity,
      stockAntes: antes,
      stockDespues: tresDecimales((antes ?? 0) - l.quantity),
    });
  }

  // Quedar en cero no es faltante: se usó lo último que había. La pantalla de
  // Insumos ya lo muestra como "Sin stock" para que se reponga.
  const faltantes = descontar
    .filter((d) => d.stockDespues < 0)
    .sort((a, b) => a.stockDespues - b.stockDespues);

  return { descontar, faltantes, omitidos };
}
