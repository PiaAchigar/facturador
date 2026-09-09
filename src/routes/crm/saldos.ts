import { Hono } from "hono";
import { createDb } from "../../db/client";
import { badRequest } from "../../lib/errors";
import { auth, requireAdmin, requireAuth, requirePermission } from "../../middleware/auth";
import { listSaldosVencidos, vencerSaldoDeCliente } from "../../repositories/customers.repo";
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

export { saldosRouter };
