import { describe, expect, it } from "vitest";
import { puedeDevolverse, saldoAAcreditar, valorDeUnaSesion } from "./saldo-de-cancelacion";

const PACK = { finalAmount: 166000, sessionsTotal: 3 };

describe("valorDeUnaSesion", () => {
  it("reparte el precio entre todas las sesiones", () => {
    expect(valorDeUnaSesion(166000, 3)).toBeCloseTo(55333.33, 2);
  });

  it("sin sesiones no divide por cero", () => {
    expect(valorDeUnaSesion(166000, 0)).toBe(0);
  });
});

describe("saldoAAcreditar — una seña también queda a favor", () => {
  it("pagó una seña del 40% y no consumió: le queda toda a favor", () => {
    // Es lo primero que se le ofrece a la clienta: "tenés esta plata para el
    // tratamiento que quieras". Recién si no vuelve en 3 meses se pierde.
    expect(saldoAAcreditar({ pagado: 66400, ...PACK, consumidas: 0 })).toBe(66400);
  });

  it("pagó una seña y consumió una sesión: se descuenta al precio", () => {
    // La sesión vale $55.333, no un tercio de la seña.
    expect(saldoAAcreditar({ pagado: 66400, ...PACK, consumidas: 1 })).toBe(11067);
  });

  it("consumió más valor del que pagó: cero, no deuda", () => {
    // Pagó $66.400 y se hizo 2 sesiones que valen $110.667.
    expect(saldoAAcreditar({ pagado: 66400, ...PACK, consumidas: 2 })).toBe(0);
  });
});

describe("saldoAAcreditar — pagado el 100%", () => {
  it("sin consumir, vuelve todo", () => {
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 0 })).toBe(166000);
  });

  it("con una de tres consumida, se descuenta esa sesión", () => {
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 1 })).toBe(110667);
  });

  it("con dos consumidas, queda una", () => {
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 2 })).toBe(55333);
  });

  it("consumido todo, no queda nada", () => {
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 3 })).toBe(0);
  });

  it("el redondeo nunca acredita más de lo pagado", () => {
    const partes = [0, 1, 2, 3].map((c) => saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: c }));
    expect(partes.every((p) => p <= 166000)).toBe(true);
  });

  it("pagó de más: vuelve lo que entró, no el precio", () => {
    expect(saldoAAcreditar({ pagado: 180000, ...PACK, consumidas: 0 })).toBe(180000);
  });

  it("un servicio suelto ya hecho no deja nada", () => {
    expect(saldoAAcreditar({ pagado: 51000, finalAmount: 51000, sessionsTotal: 1, consumidas: 1 })).toBe(0);
  });

  it("las agendadas NO cuentan como consumidas", () => {
    // Sólo se descuenta lo que se HIZO. Si se rompió la máquina, ese turno se
    // reagenda desde la Agenda y la sesión sigue intacta.
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 0 })).toBe(166000);
  });
});

describe("saldoAAcreditar — bordes", () => {
  it("si no pagó nada, no hay nada a favor", () => {
    expect(saldoAAcreditar({ pagado: 0, ...PACK, consumidas: 0 })).toBe(0);
  });

  it("una compra sin sesiones cargadas devuelve lo pagado", () => {
    expect(saldoAAcreditar({ pagado: 51000, finalAmount: 51000, sessionsTotal: 0, consumidas: 0 })).toBe(51000);
  });
});

describe("puedeDevolverse — la plata en mano exige el 100%", () => {
  it("pagado entero: sí", () => {
    expect(puedeDevolverse({ pagado: 166000, finalAmount: 166000 })).toBe(true);
  });

  it("una seña: no", () => {
    // Le queda a favor, pero no se le saca de la caja.
    expect(puedeDevolverse({ pagado: 66400, finalAmount: 166000 })).toBe(false);
  });

  it("casi todo pero no todo: no", () => {
    expect(puedeDevolverse({ pagado: 165000, finalAmount: 166000 })).toBe(false);
  });

  it("pagó de más: sí, con más razón está paga", () => {
    expect(puedeDevolverse({ pagado: 180000, finalAmount: 166000 })).toBe(true);
  });

  it("sin pagar nada no hay nada que devolver", () => {
    // El 0 >= 0 de una compra sin precio diría que sí. No hay plata: es que no.
    expect(puedeDevolverse({ pagado: 0, finalAmount: 0 })).toBe(false);
  });
});
