/**
 * La receta de un servicio: qué insumos consume y en qué cantidad.
 *
 * Lógica pura, sin base de datos. Es la que después permite descontar stock
 * solo al completar un turno (decisión de Laura, 2026-09-08).
 */

export type LineaReceta = { productId: string; quantity: number };

/**
 * Limpia lo que manda la pantalla.
 *
 * Una cantidad en 0, negativa o sin cargar NO es una línea de receta: tildar un
 * insumo y dejarlo en 0 es no usarlo, y una cantidad negativa SUMARÍA stock
 * cada vez que se hace el servicio.
 *
 * Si el mismo insumo viene dos veces se queda con el último: la pantalla no
 * debería mandarlo repetido, pero insertar dos filas rompería el índice único
 * y se perdería el guardado entero.
 */
export function normalizarReceta(
  lineas: readonly { productId: string; quantity: number | null | undefined }[],
): LineaReceta[] {
  const porInsumo = new Map<string, number>();
  for (const l of lineas) {
    if (l.quantity == null || l.quantity <= 0) continue;
    porInsumo.set(l.productId, l.quantity);
  }
  return [...porInsumo].map(([productId, quantity]) => ({ productId, quantity }));
}

export type DiffReceta = {
  agregar: LineaReceta[];
  actualizar: LineaReceta[];
  borrar: string[];
};

/**
 * Qué hay que hacer para que la receta guardada quede igual a la pedida.
 *
 * Cambiar una cantidad ACTUALIZA en vez de borrar y recrear: el `created_at` es
 * lo único que dice desde cuándo ese servicio usa ese insumo, y recrear la fila
 * lo perdería.
 */
export function diffReceta(
  actual: readonly LineaReceta[],
  deseada: readonly LineaReceta[],
): DiffReceta {
  const previas = new Map(actual.map((l) => [l.productId, l.quantity]));
  const nuevas = new Map(deseada.map((l) => [l.productId, l.quantity]));

  const agregar: LineaReceta[] = [];
  const actualizar: LineaReceta[] = [];
  for (const [productId, quantity] of nuevas) {
    if (!previas.has(productId)) agregar.push({ productId, quantity });
    else if (previas.get(productId) !== quantity) actualizar.push({ productId, quantity });
  }

  const borrar = [...previas.keys()].filter((id) => !nuevas.has(id));
  return { agregar, actualizar, borrar };
}

/**
 * Lo que cuesta en insumos hacer el servicio una vez.
 *
 * Las líneas sin costo cargado suman 0 en vez de romper la cuenta: al principio
 * es lo normal, el insumo existe pero nadie le puso precio todavía.
 */
export function costoDeReceta(
  lineas: readonly { quantity: number; unitCost: number | null | undefined }[],
): number {
  const total = lineas.reduce((acc, l) => acc + l.quantity * (l.unitCost ?? 0), 0);
  return Math.round(total * 100) / 100;
}
