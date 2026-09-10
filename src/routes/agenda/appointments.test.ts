import { describe, expect, it } from "vitest";
import { appointmentsRouter } from "./appointments";

describe("el orden de las rutas", () => {
  /**
   * Hono resuelve por ORDEN DE REGISTRO. Si `/:id` se registra antes que
   * `/consumible`, la consulta de qué se descuenta entra por el comodín con
   * id="consumible" y devuelve un 404 — sin error, sin aviso: la pantalla de
   * turno nuevo simplemente nunca ofrecería descontar del pack.
   *
   * Ya pasó dos veces en este repo (`/credits/expired`, `/admin/tarifarios`).
   */
  it("/consumible va ANTES del comodín /:id", () => {
    const gets = appointmentsRouter.routes.filter((r) => r.method === "GET").map((r) => r.path);
    const comodin = gets.indexOf("/:id");
    const consumible = gets.indexOf("/consumible");

    expect(comodin).toBeGreaterThanOrEqual(0);
    expect(consumible).toBeGreaterThanOrEqual(0);
    expect(consumible).toBeLessThan(comodin);
  });
});
