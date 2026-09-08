import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { appointmentProductConsumption, products, serviceProduct } from "../db/schema";
import { planDeConsumo, type PlanDeConsumo } from "../lib/consumo";

/** Subconjunto de `Db` que también sirve dentro de una transacción (`tx`). */
type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

/** Lo que se le devuelve a la pantalla para que avise. */
export type ResultadoConsumo = Pick<PlanDeConsumo, "faltantes" | "omitidos"> & {
  descontados: number;
};

const SIN_CONSUMO: ResultadoConsumo = { descontados: 0, faltantes: [], omitidos: [] };

/**
 * Descuenta del stock los insumos que consumió un turno.
 *
 * Se llama SÓLO en la transición a 'completed', y SIEMPRE dentro de la misma
 * transacción que cambia el estado: si el turno se completara y el descuento
 * fallara, el stock quedaría mintiendo para siempre y nadie se enteraría.
 *
 * Nunca frena el turno por falta de stock (decisión de Laura, 2026-09-08). Lo
 * que devuelve es para avisar, no para decidir.
 */
export async function consumirInsumos(
  tx: Tx,
  appointmentId: string,
  serviceId: string | null,
): Promise<ResultadoConsumo> {
  if (!serviceId) return SIN_CONSUMO;

  const receta = await tx
    .select({
      productId: serviceProduct.productId,
      quantity: serviceProduct.quantity,
      name: products.name,
      quantityInStock: products.quantityInStock,
      isActive: products.isActive,
    })
    .from(serviceProduct)
    .innerJoin(products, eq(products.id, serviceProduct.productId))
    .where(eq(serviceProduct.serviceId, serviceId));

  if (receta.length === 0) return SIN_CONSUMO;

  const plan = planDeConsumo(
    receta
      .filter((r): r is typeof r & { productId: string } => r.productId != null)
      .map((r) => ({
        productId: r.productId,
        name: r.name,
        quantity: Number(r.quantity),
        quantityInStock: r.quantityInStock != null ? Number(r.quantityInStock) : null,
        isActive: r.isActive,
      })),
  );

  for (const d of plan.descontar) {
    // El descuento se calcula EN LA BASE (`- quantity`) y no se escribe el
    // `stockDespues` que calculó el plan: entre que se leyó el stock y se
    // escribe, otro turno pudo descontar del mismo insumo. Escribir el valor
    // leído le pisaría el descuento al otro.
    await tx
      .update(products)
      .set({
        quantityInStock: sql`COALESCE(${products.quantityInStock}, 0) - ${String(d.quantity)}`,
        updatedAt: new Date(),
      })
      .where(eq(products.id, d.productId));
  }

  if (plan.descontar.length > 0) {
    // El UNIQUE (appointment_id, product_id) es lo que impide descontar dos
    // veces el mismo turno: si dos requests simultáneas llegan hasta acá, la
    // segunda revienta y su transacción entera se deshace, incluido el UPDATE
    // de arriba.
    await tx.insert(appointmentProductConsumption).values(
      plan.descontar.map((d) => ({
        appointmentId,
        productId: d.productId,
        quantity: String(d.quantity),
        stockAfter: String(d.stockDespues),
      })),
    );
  }

  return {
    descontados: plan.descontar.length,
    faltantes: plan.faltantes,
    omitidos: plan.omitidos,
  };
}
