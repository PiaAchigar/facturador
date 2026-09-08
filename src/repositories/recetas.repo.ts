import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { products, service, serviceProduct } from "../db/schema";
import { diffReceta, normalizarReceta, type LineaReceta } from "../lib/receta";

/**
 * La receta de un servicio: qué insumos consume y cuánto.
 *
 * Un servicio "lleva insumos" si tiene filas acá. No hace falta una columna
 * para eso, igual que un insumo es vendible por tener precio.
 */
export async function listRecetaDeServicio(db: Db, serviceId: string) {
  return db
    .select({
      productId: serviceProduct.productId,
      quantity: serviceProduct.quantity,
      name: products.name,
      unitType: products.unitType,
      unitCost: products.unitCost,
      isActive: products.isActive,
    })
    .from(serviceProduct)
    .innerJoin(products, eq(products.id, serviceProduct.productId))
    .where(eq(serviceProduct.serviceId, serviceId))
    .orderBy(asc(products.name));
}

/** Los servicios que usan un insumo. Alimenta la carga masiva y el impacto de archivar. */
export async function listServiciosDeInsumo(db: Db, productId: string) {
  return db
    .select({
      serviceId: serviceProduct.serviceId,
      quantity: serviceProduct.quantity,
      name: service.name,
      isActive: service.isActive,
    })
    .from(serviceProduct)
    .innerJoin(service, eq(service.id, serviceProduct.serviceId))
    .where(eq(serviceProduct.productId, productId))
    .orderBy(asc(service.name));
}

async function recetaActual(db: Db, serviceId: string): Promise<LineaReceta[]> {
  const rows = await db
    .select({ productId: serviceProduct.productId, quantity: serviceProduct.quantity })
    .from(serviceProduct)
    .where(eq(serviceProduct.serviceId, serviceId));
  return rows
    .filter((r): r is { productId: string; quantity: string } => r.productId != null)
    .map((r) => ({ productId: r.productId, quantity: Number(r.quantity) }));
}

/**
 * Deja la receta del servicio exactamente como se pidió.
 *
 * Va en una transacción: una receta a medio guardar descontaría mal el stock de
 * todos los turnos siguientes. Y actualiza en vez de borrar y recrear, para no
 * perder el `created_at` de las líneas que sólo cambiaron de cantidad.
 */
export async function setRecetaDeServicio(
  db: Db,
  serviceId: string,
  pedida: readonly { productId: string; quantity: number | null }[],
) {
  const deseada = normalizarReceta(pedida);
  const actual = await recetaActual(db, serviceId);
  const { agregar, actualizar, borrar } = diffReceta(actual, deseada);

  if (agregar.length === 0 && actualizar.length === 0 && borrar.length === 0) return;

  await db.transaction(async (tx) => {
    if (borrar.length > 0) {
      await tx
        .delete(serviceProduct)
        .where(
          and(
            eq(serviceProduct.serviceId, serviceId),
            inArray(serviceProduct.productId, borrar),
          ),
        );
    }
    if (agregar.length > 0) {
      await tx.insert(serviceProduct).values(
        agregar.map((l) => ({
          serviceId,
          productId: l.productId,
          quantity: String(l.quantity),
        })),
      );
    }
    for (const l of actualizar) {
      await tx
        .update(serviceProduct)
        .set({ quantity: String(l.quantity), updatedAt: new Date() })
        .where(
          and(
            eq(serviceProduct.serviceId, serviceId),
            eq(serviceProduct.productId, l.productId),
          ),
        );
    }
  });
}

/**
 * Carga masiva: un insumo, una cantidad, muchos servicios.
 *
 * Existe porque cargar las recetas servicio por servicio son 120 modales. Si
 * "guantes" lo usan 90 servicios, esto lo resuelve en una pantalla.
 *
 * Sólo AGREGA o ACTUALIZA los servicios que se marcaron: no toca los demás ni
 * borra el resto de la receta de cada servicio. Desmarcar un servicio acá lo
 * saca — pero sólo de este insumo.
 */
export async function asignarInsumoAServicios(
  db: Db,
  productId: string,
  serviceIds: readonly string[],
  quantity: number,
) {
  if (quantity <= 0) throw new Error("La cantidad tiene que ser mayor a 0");

  const previos = await db
    .select({ serviceId: serviceProduct.serviceId })
    .from(serviceProduct)
    .where(eq(serviceProduct.productId, productId));
  const antes = new Set(previos.map((p) => p.serviceId).filter((s): s is string => s != null));
  const ahora = new Set(serviceIds);

  const agregar = [...ahora].filter((s) => !antes.has(s));
  const actualizar = [...ahora].filter((s) => antes.has(s));
  const borrar = [...antes].filter((s) => !ahora.has(s));

  await db.transaction(async (tx) => {
    if (borrar.length > 0) {
      await tx
        .delete(serviceProduct)
        .where(
          and(eq(serviceProduct.productId, productId), inArray(serviceProduct.serviceId, borrar)),
        );
    }
    if (agregar.length > 0) {
      await tx
        .insert(serviceProduct)
        .values(agregar.map((s) => ({ serviceId: s, productId, quantity: String(quantity) })));
    }
    if (actualizar.length > 0) {
      await tx
        .update(serviceProduct)
        .set({ quantity: String(quantity), updatedAt: new Date() })
        .where(
          and(
            eq(serviceProduct.productId, productId),
            inArray(serviceProduct.serviceId, actualizar),
          ),
        );
    }
  });

  return { agregados: agregar.length, actualizados: actualizar.length, quitados: borrar.length };
}
