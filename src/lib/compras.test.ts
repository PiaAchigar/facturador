import { describe, expect, it } from "vitest";
import { estadoDeSesion, resumenDeCompra } from "./compras";

const AHORA = new Date("2026-09-08T12:00:00Z");
const VIGENTE = { expiresAt: new Date("2026-12-31T00:00:00Z"), cancelledAt: null };
const VENCIDA = { expiresAt: new Date("2026-08-01T00:00:00Z"), cancelledAt: null };
const SIN_VENCIMIENTO = { expiresAt: null, cancelledAt: null };

const libre = { consumedAt: null, appointmentId: null, appointmentStatus: null };

describe("estadoDeSesion", () => {
  it("sin turno ni consumo está disponible", () => {
    expect(estadoDeSesion(libre, VIGENTE, AHORA)).toBe("disponible");
  });

  it("con turno está agendada", () => {
    expect(
      estadoDeSesion({ ...libre, appointmentId: "a1", appointmentStatus: "scheduled" }, VIGENTE, AHORA),
    ).toBe("agendada");
  });

  it("consumida gana sobre agendada", () => {
    expect(
      estadoDeSesion(
        { consumedAt: new Date("2026-09-01T10:00:00Z"), appointmentId: "a1", appointmentStatus: "completed" },
        VIGENTE,
        AHORA,
      ),
    ).toBe("consumida");
  });

  it("un turno CANCELADO devuelve la sesión a disponible", () => {
    // Sin escribir nada: la condición deja de cumplirse sola. Esa es toda la
    // diferencia con guardar un estado en la fila, que se desincroniza.
    expect(
      estadoDeSesion({ ...libre, appointmentId: "a1", appointmentStatus: "cancelled" }, VIGENTE, AHORA),
    ).toBe("disponible");
  });

  it("un turno con ausente también la devuelve a disponible", () => {
    expect(
      estadoDeSesion({ ...libre, appointmentId: "a1", appointmentStatus: "no_show" }, VIGENTE, AHORA),
    ).toBe("disponible");
  });

  it("si el pack venció, lo que quedaba libre está vencido", () => {
    expect(estadoDeSesion(libre, VENCIDA, AHORA)).toBe("vencida");
  });

  it("lo YA CONSUMIDO no se vence", () => {
    // La sesión se usó cuando el pack estaba vigente: que hoy esté vencido no
    // borra que se hizo.
    expect(
      estadoDeSesion({ ...libre, consumedAt: new Date("2026-07-01T10:00:00Z") }, VENCIDA, AHORA),
    ).toBe("consumida");
  });

  it("una sesión agendada en un pack vencido sigue agendada", () => {
    // El turno existe y alguien va a venir. Decirle "vencida" haría que se la
    // ignore y la clienta llegue a un turno que nadie esperaba.
    expect(
      estadoDeSesion({ ...libre, appointmentId: "a1", appointmentStatus: "scheduled" }, VENCIDA, AHORA),
    ).toBe("agendada");
  });

  it("un pack sin vencimiento no vence nunca", () => {
    expect(estadoDeSesion(libre, SIN_VENCIMIENTO, AHORA)).toBe("disponible");
  });

  it("una compra CANCELADA vence todo lo que no se usó", () => {
    const cancelada = { expiresAt: null, cancelledAt: new Date("2026-09-01T00:00:00Z") };
    expect(estadoDeSesion(libre, cancelada, AHORA)).toBe("vencida");
    expect(estadoDeSesion({ ...libre, consumedAt: AHORA }, cancelada, AHORA)).toBe("consumida");
  });
});

describe("resumenDeCompra", () => {
  const compra = { finalAmount: 91800, ...VIGENTE };
  const cuatro = [
    { consumedAt: AHORA, appointmentId: "a1", appointmentStatus: "completed" },
    { consumedAt: null, appointmentId: "a2", appointmentStatus: "scheduled" },
    libre,
    libre,
  ];

  it("cuenta cada estado por separado", () => {
    const r = resumenDeCompra(compra, cuatro, [], AHORA);
    expect(r).toMatchObject({ consumidas: 1, agendadas: 1, disponibles: 2, vencidas: 0 });
  });

  it("el saldo es el precio final menos lo pagado", () => {
    const r = resumenDeCompra(compra, cuatro, [40000, 20000], AHORA);
    expect(r.pagado).toBe(60000);
    expect(r.saldo).toBe(31800);
  });

  it("sin pagos, el saldo es todo el precio", () => {
    expect(resumenDeCompra(compra, cuatro, [], AHORA).saldo).toBe(91800);
  });

  it("pagada de más, el saldo es 0 y no negativo", () => {
    // Un saldo negativo se leería como "hay que devolverle plata", que es otra
    // cosa y vive en el saldo a favor del cliente.
    const r = resumenDeCompra(compra, cuatro, [100000], AHORA);
    expect(r.saldo).toBe(0);
  });

  it("está saldada cuando no queda nada por cobrar", () => {
    expect(resumenDeCompra(compra, cuatro, [91800], AHORA).saldada).toBe(true);
    expect(resumenDeCompra(compra, cuatro, [40000], AHORA).saldada).toBe(false);
  });

  it("un pack vencido cuenta como vencidas lo que quedaba libre", () => {
    const r = resumenDeCompra({ finalAmount: 91800, ...VENCIDA }, cuatro, [], AHORA);
    expect(r).toMatchObject({ consumidas: 1, agendadas: 1, disponibles: 0, vencidas: 2 });
  });

  it("sin sesiones no rompe", () => {
    const r = resumenDeCompra(compra, [], [], AHORA);
    expect(r).toMatchObject({ consumidas: 0, disponibles: 0, saldo: 91800 });
  });
});
