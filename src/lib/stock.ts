/**
 * Niveles de stock de un insumo.
 *
 * Lógica pura y compartida: la usa la pantalla de Insumos para pintar el
 * semáforo y el aviso de stock mínimo que pidió Laura. Vive acá para poder
 * testearla sin base de datos.
 */

export type NivelDeStock = "sin_stock" | "bajo" | "ok" | "desconocido";

/**
 * `minimumStock` es "avisame cuando llegues acá", no "cuando lo pases": llegar
 * justo al mínimo ya es aviso. Un mínimo en 0 (o sin cargar) significa "no me
 * avises" y sólo distingue si hay unidades o no.
 *
 * El stock puede quedar en negativo: al completar un servicio se descuenta
 * aunque no alcance (decisión de Laura, 2026-09-08 — bloquear un turno ya hecho
 * por un dato de inventario mal cargado le frena la caja).
 */
export function nivelDeStock(
  quantityInStock: number | null | undefined,
  minimumStock: number | null | undefined,
): NivelDeStock {
  if (quantityInStock == null) return "desconocido";
  if (quantityInStock <= 0) return "sin_stock";
  if (minimumStock != null && minimumStock > 0 && quantityInStock <= minimumStock) return "bajo";
  return "ok";
}

type ConStock = {
  quantityInStock: number | null;
  minimumStock: number | null;
};

/**
 * Los insumos que hay que reponer, primero los que no tienen nada.
 *
 * Deja afuera los `desconocido`: un insumo sin stock cargado está a medio
 * cargar, no es una alerta. Avisar por esos entrena a ignorar el aviso.
 */
export function insumosParaAvisar<T extends ConStock>(insumos: readonly T[]): T[] {
  const prioridad: Record<string, number> = { sin_stock: 0, bajo: 1 };
  return insumos
    .map((i) => ({ i, nivel: nivelDeStock(i.quantityInStock, i.minimumStock) }))
    .filter((x) => x.nivel === "sin_stock" || x.nivel === "bajo")
    .sort((a, b) => prioridad[a.nivel]! - prioridad[b.nivel]!)
    .map((x) => x.i);
}
