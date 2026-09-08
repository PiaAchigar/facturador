import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { products } from "../db/schema";

/**
 * Insumos = filas de `products` con `is_supply = true`.
 *
 * Se reusa `products` en vez de una tabla nueva porque un mismo frasco de crema
 * puede ser insumo de un tratamiento Y producto de reventa; con dos tablas
 * habría que cargarlo dos veces y los stocks se irían separando. La marca
 * `isSupply` es lo que evita que cada caja de guantes aparezca como producto
 * vendible en el facturador — `line_items.product_id` apunta a esta misma tabla.
 */
const supplyFields = {
  id: products.id,
  name: products.name,
  description: products.description,
  code: products.code,
  unitType: products.unitType,
  quantityInStock: products.quantityInStock,
  minimumStock: products.minimumStock,
  unitCost: products.unitCost,
  unitPrice: products.unitPrice,
  supplierInfo: products.supplierInfo,
  taxCategory: products.taxCategory,
  isActive: products.isActive,
};

/** Sin `includeInactive`, oculta los archivados. */
export async function listSupplies(db: Db, includeInactive = false) {
  const base = db.select(supplyFields).from(products);
  const filtrada = includeInactive
    ? base.where(eq(products.isSupply, true))
    : base.where(and(eq(products.isSupply, true), eq(products.isActive, true)));
  return filtrada.orderBy(asc(products.name));
}

export async function getSupplyById(db: Db, id: string) {
  const rows = await db
    .select(supplyFields)
    .from(products)
    .where(and(eq(products.id, id), eq(products.isSupply, true)))
    .limit(1);
  return rows[0] ?? null;
}

export type SupplyInput = {
  name: string;
  description?: string | null;
  code?: string | null;
  unitType?: string | null;
  quantityInStock?: number | null;
  minimumStock?: number | null;
  unitCost?: number | null;
  unitPrice?: number | null;
  supplierInfo?: string | null;
  taxCategory?: string | null;
};

/** Los `numeric` de la base los quiere Drizzle como string. */
function aColumnas(p: Partial<SupplyInput>) {
  const { unitCost, unitPrice, ...resto } = p;
  return {
    ...resto,
    ...(unitCost !== undefined && { unitCost: unitCost === null ? null : String(unitCost) }),
    ...(unitPrice !== undefined && { unitPrice: unitPrice === null ? null : String(unitPrice) }),
  };
}

export async function createSupply(db: Db, data: SupplyInput) {
  const rows = await db
    .insert(products)
    .values({ ...aColumnas(data), isSupply: true, isActive: true })
    .returning(supplyFields);
  return rows[0]!;
}

/** Actualiza sólo los campos que vengan. */
export async function updateSupply(db: Db, id: string, patch: Partial<SupplyInput>) {
  const columnas = aColumnas(patch);
  if (Object.keys(columnas).length === 0) return getSupplyById(db, id);

  const rows = await db
    .update(products)
    .set({ ...columnas, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.isSupply, true)))
    .returning(supplyFields);
  return rows[0] ?? null;
}

/** Archiva (false) o restaura (true). Nunca borra: regla 1.3. */
export async function setSupplyActive(db: Db, id: string, isActive: boolean) {
  const rows = await db
    .update(products)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.isSupply, true)))
    .returning(supplyFields);
  return rows[0] ?? null;
}
