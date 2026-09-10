import { Hono } from "hono";
import { createDb } from "../../db/client";
import { badRequest } from "../../lib/errors";
import { auth, requireAdmin, requireAuth, requirePermission } from "../../middleware/auth";
import {
  aplazarVencimientos,
  estadoDeSaldoDeCliente,
  listSaldosVencidos,
  vencerSaldoDeCliente,
} from "../../repositories/customers.repo";
import type { AppBindings, Variables } from "../../env";

const saldosRouter = new Hono<{ Bindings: AppBindings; Variables: Variables }>();

/**
 * A quiénes se les venció el saldo a favor y por cuánto.
 *
 * Alimenta el aviso de la pantalla de Clientes. Devuelve también de DÓNDE vino
 * cada peso: meses después, "Saldo a favor vencido — Mariana" sin el origen no
 * le dice nada a nadie.
 */
saldosRouter.get(
  "/expired",
  auth,
  requireAuth,
  requirePermission("crm", "view"),
  async (c) => {
    const db = createDb(c.env);
    const vencidos = await listSaldosVencidos(db);
    return c.json({
      clientes: vencidos,
      total: vencidos.reduce((a, v) => a + v.vencido, 0),
    });
  },
);

/**
 * Da por vencido el saldo de una clienta y lo pasa a la caja del día.
 *
 * **Se confirma, no pasa solo** (decisión de Pia, 2026-09-09): es plata que
 * cambia de dueño, y si la clienta aparece al otro día reclamando, con el
 * automático Laura se entera cuando ya está hecho.
 *
 * Sólo admin, igual que devolver: las dos son las únicas acciones que mueven
 * plata fuera de la cuenta de la clienta.
 */
saldosRouter.post(
  "/:customerId/expire",
  auth,
  requireAuth,
  requireAdmin,
  async (c) => {
    const db = createDb(c.env);
    const hecho = await vencerSaldoDeCliente(db, c.req.param("customerId"));
    if (!hecho) throw badRequest("Esta clienta no tiene saldo vencido.");
    return c.json(hecho);
  },
);

/**
 * El saldo de UNA clienta, abierto en lotes con sus fechas.
 *
 * ⚠️ Va DESPUÉS de `/expired` a propósito. Hono resuelve por orden de
 * registro, así que si `/:customerId` se declarara antes se tragaría la
 * palabra "expired" como si fuera un id. Es el mismo tipo de choque que ya
 * hubo entre `/expire` y `/expired`.
 */
saldosRouter.get(
  "/:customerId",
  auth,
  requireAuth,
  requirePermission("crm", "view"),
  async (c) => {
    const db = createDb(c.env);
    return c.json(await estadoDeSaldoDeCliente(db, c.req.param("customerId")));
  },
);

/**
 * Corre para adelante el vencimiento de uno o varios saldos.
 *
 * Pide `crm:manage` y no admin (decisión de Pia, 2026-09-10): aplazar no saca
 * plata de la caja, se la deja a la clienta, y quien está en el mostrador tiene
 * que poder resolverlo sin llamar a Laura. Lo irreversible —pasar a caja,
 * devolver— sigue siendo admin.
 */
saldosRouter.post(
  "/:customerId/postpone",
  auth,
  requireAuth,
  requirePermission("crm", "manage"),
  async (c) => {
    const db = createDb(c.env);
    const body = await c.req.json<{
      movimientoIds?: unknown;
      nuevaFecha?: unknown;
      motivo?: unknown;
    }>();

    const ids = Array.isArray(body.movimientoIds)
      ? body.movimientoIds.filter((v): v is string => typeof v === "string")
      : [];
    if (typeof body.nuevaFecha !== "string") throw badRequest("Falta la fecha nueva.");
    const nuevaFecha = new Date(body.nuevaFecha);
    if (Number.isNaN(nuevaFecha.getTime())) throw badRequest("La fecha nueva no es válida.");

    const r = await aplazarVencimientos(
      db,
      c.req.param("customerId"),
      ids,
      nuevaFecha,
      typeof body.motivo === "string" ? body.motivo : null,
    );
    if ("error" in r) throw badRequest(r.error);
    return c.json(r);
  },
);

export { saldosRouter };
