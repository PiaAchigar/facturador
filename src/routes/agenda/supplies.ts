import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createDb } from "../../db/client";
import { notFound } from "../../lib/errors";
import { nivelDeStock } from "../../lib/stock";
import { auth, requireAuth, requirePermission } from "../../middleware/auth";
import {
  createSupply,
  listSupplies,
  setSupplyActive,
  updateSupply,
} from "../../repositories/supplies.repo";
import { asignarInsumoAServicios, listServiciosDeInsumo } from "../../repositories/recetas.repo";
import type { AppBindings, Variables } from "../../env";

const suppliesRouter = new Hono<{ Bindings: AppBindings; Variables: Variables }>();

/**
 * Los `numeric` vienen como string de Drizzle: si se mandan así, el front
 * compara "5000" > 0 y muestra cualquier cosa. `nivel` se calcula acá para que
 * la pantalla y cualquier futuro aviso usen exactamente el mismo criterio.
 */
function serialize<T extends { unitCost?: unknown; unitPrice?: unknown; quantityInStock?: number | null; minimumStock?: number | null }>(
  s: T,
) {
  return {
    ...s,
    unitCost: s.unitCost != null ? Number(s.unitCost) : null,
    unitPrice: s.unitPrice != null ? Number(s.unitPrice) : null,
    nivel: nivelDeStock(s.quantityInStock, s.minimumStock),
  };
}

suppliesRouter.get(
  "/",
  auth,
  requireAuth,
  requirePermission("catalogo", "view"),
  zValidator("query", z.object({ includeInactive: z.string().optional() })),
  async (c) => {
    const db = createDb(c.env);
    const rows = await listSupplies(db, c.req.valid("query").includeInactive === "true");
    return c.json(rows.map(serialize));
  },
);

const supplyBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(255).nullish(),
  code: z.string().max(50).nullish(),
  unitType: z.string().max(50).nullish(),
  // El stock admite negativos a propósito: al completar un servicio se descuenta
  // aunque no alcance (decisión de Laura, 2026-09-08).
  quantityInStock: z.number().int().nullish(),
  minimumStock: z.number().int().nonnegative().nullish(),
  unitCost: z.number().nonnegative().nullish(),
  unitPrice: z.number().nonnegative().nullish(),
  supplierInfo: z.string().max(2000).nullish(),
  taxCategory: z.string().max(50).nullish(),
});

suppliesRouter.post(
  "/",
  auth,
  requireAuth,
  requirePermission("catalogo", "manage"),
  zValidator("json", supplyBody.extend({ name: z.string().min(1).max(255) })),
  async (c) => {
    const db = createDb(c.env);
    const created = await createSupply(db, c.req.valid("json"));
    return c.json(serialize(created), 201);
  },
);

suppliesRouter.patch(
  "/:id",
  auth,
  requireAuth,
  requirePermission("catalogo", "edit"),
  zValidator("json", supplyBody),
  async (c) => {
    const db = createDb(c.env);
    const updated = await updateSupply(db, c.req.param("id"), c.req.valid("json"));
    if (!updated) throw notFound("Supply");
    return c.json(serialize(updated));
  },
);

suppliesRouter.delete(
  "/:id",
  auth,
  requireAuth,
  requirePermission("catalogo", "manage"),
  async (c) => {
    const db = createDb(c.env);
    const archived = await setSupplyActive(db, c.req.param("id"), false);
    if (!archived) throw notFound("Supply");
    return c.json(serialize(archived));
  },
);

suppliesRouter.post(
  "/:id/restore",
  auth,
  requireAuth,
  requirePermission("catalogo", "manage"),
  async (c) => {
    const db = createDb(c.env);
    const restored = await setSupplyActive(db, c.req.param("id"), true);
    if (!restored) throw notFound("Supply");
    return c.json(serialize(restored));
  },
);

// ── Carga masiva: un insumo → muchos servicios (1.43.0) ─────────────────────

/** Qué servicios usan este insumo. Alimenta el selector de la carga masiva. */
suppliesRouter.get(
  "/:id/services",
  auth,
  requireAuth,
  requirePermission("catalogo", "edit"),
  async (c) => {
    const db = createDb(c.env);
    const rows = await listServiciosDeInsumo(db, c.req.param("id"));
    return c.json(rows.map((r) => ({ ...r, quantity: Number(r.quantity) })));
  },
);

/**
 * Asigna este insumo, con la misma cantidad, a la lista de servicios que venga.
 *
 * Existe porque cargar receta por receta son 120 modales. Sólo toca este
 * insumo: no borra el resto de la receta de cada servicio.
 */
suppliesRouter.put(
  "/:id/services",
  auth,
  requireAuth,
  requirePermission("catalogo", "edit"),
  zValidator(
    "json",
    z.object({
      serviceIds: z.array(z.string().uuid()).default([]),
      quantity: z.number().positive(),
    }),
  ),
  async (c) => {
    const db = createDb(c.env);
    const { serviceIds, quantity } = c.req.valid("json");
    const resumen = await asignarInsumoAServicios(db, c.req.param("id"), serviceIds, quantity);
    return c.json(resumen);
  },
);

export { suppliesRouter };
