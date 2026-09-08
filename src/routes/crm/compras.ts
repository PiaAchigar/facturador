import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createDb } from "../../db/client";
import { badRequest, notFound } from "../../lib/errors";
import { auth, requireAuth, requirePermission } from "../../middleware/auth";
import { cancelCompra, createCompra, listComprasDeCliente } from "../../repositories/compras.repo";
import {
  listCatalogoVendible,
  listPromosVendibles,
  obtenerItemVendible,
  obtenerPromoVendible,
} from "../../repositories/catalogo-venta.repo";
import { cotizar } from "../../lib/cotizacion";
import type { AppBindings, Variables } from "../../env";

const comprasRouter = new Hono<{ Bindings: AppBindings; Variables: Variables }>();

/**
 * Las compras de una clienta: qué adquirió, cuánto pagó, cuánto debe y en qué
 * estado está cada sesión. Alimenta la card "Compras del Cliente".
 */
comprasRouter.get(
  "/customers/:id/purchases",
  auth,
  requireAuth,
  requirePermission("crm", "view"),
  async (c) => {
    const db = createDb(c.env);
    return c.json(await listComprasDeCliente(db, c.req.param("id")));
  },
);

/**
 * Todo lo que se puede vender, en una sola forma, más las promos vigentes.
 *
 * Va acá y no en `/api/agenda/...` por dos motivos: el permiso es el de quien
 * vende (`crm`), y así la pantalla de venta hace UNA llamada en vez de cuatro
 * a rutas de secciones distintas.
 */
comprasRouter.get(
  "/purchases/catalog",
  auth,
  requireAuth,
  requirePermission("crm", "view"),
  async (c) => {
    const db = createDb(c.env);
    const [catalogo, promociones] = await Promise.all([
      listCatalogoVendible(db),
      listPromosVendibles(db),
    ]);
    return c.json({ ...catalogo, promociones });
  },
);

/**
 * Cotiza sin vender: cuánto sale esto, con este descuento, hasta cuándo vale.
 *
 * La cuenta corre acá y no en el navegador porque el precio sale del catálogo
 * —zonas de depilación, líneas de combo, política global— y espejar todo eso
 * en front-crm sería una segunda copia que se desincroniza sola. Lo que sí se
 * mantiene del diseño es que la venta CONGELA lo cotizado: la pantalla manda
 * de vuelta estos tres montos, que son los que Laura vio.
 */
comprasRouter.post(
  "/purchases/quote",
  auth,
  requireAuth,
  requirePermission("crm", "view"),
  zValidator(
    "json",
    z.object({
      origen: z.enum(["combo", "depilacion", "servicio"]),
      id: z.string().uuid(),
      sessions: z.number().int().positive(),
      promotionId: z.string().uuid().nullish(),
    }),
  ),
  async (c) => {
    const db = createDb(c.env);
    const { origen, id, sessions, promotionId } = c.req.valid("json");

    const item = await obtenerItemVendible(db, origen, id);
    if (!item) throw notFound(origen === "servicio" ? "Servicio" : "Combo");

    // Una promo que no está vigente no se aplica en silencio: se avisa, porque
    // el precio que Laura ve es el que se va a congelar.
    let promo = null;
    if (promotionId) {
      promo = await obtenerPromoVendible(db, promotionId);
      if (!promo) throw badRequest("Esa promoción no está vigente");
    }

    try {
      const q = cotizar(item, sessions, promo, new Date());
      return c.json({
        ...q,
        expiresAt: q.expiresAt?.toISOString() ?? null,
        // Ya listo para mandarlo a POST /purchases sin rearmarlo.
        comboId: origen === "combo" ? id : null,
        depilationComboId: origen === "depilacion" ? id : null,
        serviceId: origen === "servicio" ? id : null,
      });
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  },
);

/**
 * Vende.
 *
 * Los tres montos llegan YA CALCULADOS y acá se congelan. El motor
 * (`lib/pack-pricing.ts`) corre del lado de quien vende, que es el que sabe
 * qué promo eligió Laura y qué política de pack corre; el backend guarda el
 * precio, nunca la fórmula que lo produjo. Eso es lo que hace que la venta
 * sobreviva a cualquier cambio de precios o de motor.
 */
const compraBody = z
  .object({
    customerId: z.string().uuid(),
    comboId: z.string().uuid().nullish(),
    serviceId: z.string().uuid().nullish(),
    depilationComboId: z.string().uuid().nullish(),
    description: z.string().min(1).max(200),
    sessionsTotal: z.number().int().positive(),
    baseAmount: z.number().nonnegative(),
    discountedAmount: z.number().nonnegative(),
    finalAmount: z.number().nonnegative(),
    promotionId: z.string().uuid().nullish(),
    expiresAt: z.string().datetime({ offset: true }).nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .refine(
    (v) => [v.comboId, v.serviceId, v.depilationComboId].filter(Boolean).length === 1,
    { message: "Una compra tiene exactamente un origen: combo, servicio o combo de depilación" },
  )
  .refine((v) => v.finalAmount <= v.discountedAmount && v.discountedAmount <= v.baseAmount, {
    // Los tres montos son las tres capas en orden. Si vinieran desordenados,
    // la card mostraría un "descuento" que en realidad es un recargo.
    message: "Los montos tienen que ir de mayor a menor: base ≥ con descuento ≥ final",
  });

comprasRouter.post(
  "/purchases",
  auth,
  requireAuth,
  requirePermission("crm", "edit"),
  zValidator("json", compraBody),
  async (c) => {
    const db = createDb(c.env);
    const b = c.req.valid("json");
    try {
      const compra = await createCompra(db, {
        ...b,
        expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      });
      return c.json(compra, 201);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  },
);

/**
 * Cancela una compra. No borra: puede tener pagos y facturas colgando, y una
 * venta cancelada sigue siendo parte de la historia de la clienta.
 */
comprasRouter.post(
  "/purchases/:id/cancel",
  auth,
  requireAuth,
  requirePermission("crm", "edit"),
  zValidator("json", z.object({ reason: z.string().max(500).nullish() }).optional()),
  async (c) => {
    const db = createDb(c.env);
    const cancelada = await cancelCompra(db, c.req.param("id"), c.req.valid("json")?.reason);
    // null = no existe, o ya estaba cancelada. Las dos son "no hay nada que
    // cancelar acá"; distinguirlas no le cambia nada a quien lo pide.
    if (!cancelada) throw notFound("Compra");
    return c.json(cancelada);
  },
);

export { comprasRouter };
