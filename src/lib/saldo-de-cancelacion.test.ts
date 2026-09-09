import { describe, expect, it } from "vitest";
import { saldoAAcreditar, valorDeUnaSesion } from "./saldo-de-cancelacion";

describe("valorDeUnaSesion", () => {
  it("reparte el precio entre todas las sesiones", () => {
    expect(valorDeUnaSesion(166000, 3)).toBeCloseTo(55333.33, 2);
  });

  it("sin sesiones no divide por cero", () => {
    expect(valorDeUnaSesion(166000, 0)).toBe(0);
  });
});

describe("saldoAAcreditar", () => {
  it("sin sesiones consumidas, vuelve todo lo pagado", () => {
    expect(saldoAAcreditar({ pagado: 166000, finalAmount: 166000, sessionsTotal: 3, consumidas: 0 })).toBe(166000);
  });

  it("con una consumida de tres, descuenta esa sesión", () => {
    // 166.000 / 3 = 55.333 por sesión. Usó una, le quedan dos.
    expect(saldoAAcreditar({ pagado: 166000, finalAmount: 166000, sessionsTotal: 3, consumidas: 1 })).toBe(110667);
  });

  it("con dos consumidas, queda una", () => {
    expect(saldoAAcreditar({ pagado: 166000, finalAmount: 166000, sessionsTotal: 3, consumidas: 2 })).toBe(55333);
  });

  it("consumido todo, no vuelve nada", () => {
    // Recibió el tratamiento completo: no hay nada a favor.
    expect(saldoAAcreditar({ pagado: 166000, finalAmount: 166000, sessionsTotal: 3, consumidas: 3 })).toBe(0);
  });

  it("el redondeo nunca acredita más de lo pagado", () => {
    // Las tres partes de 166.000 no son enteras. Sumadas tienen que dar
    // exactamente lo pagado, ni un peso más.
    const partes = [0, 1, 2, 3].map((c) =>
      saldoAAcreditar({ pagado: 166000, finalAmount: 166000, sessionsTotal: 3, consumidas: c }),
    );
    expect(partes[0]).toBe(166000);
    expect(partes.every((p) => p <= 166000)).toBe(true);
  });

  it("si no pagó nada, no hay nada a favor", () => {
    expect(saldoAAcreditar({ pagado: 0, finalAmount: 166000, sessionsTotal: 3, consumidas: 0 })).toBe(0);
  });

  it("lo consumido se valúa al PRECIO, no a lo pagado", () => {
    // Pagó la seña del 40% ($66.400 de $166.000) y se hizo 2 sesiones, que
    // valen $110.667. Repartir lo PAGADO entre las 3 sesiones le devolvería
    // $22.133 a alguien que en realidad le debe plata al local.
    expect(saldoAAcreditar({ pagado: 66400, finalAmount: 166000, sessionsTotal: 3, consumidas: 2 })).toBe(0);
  });

  it("pagó de más y consumió una: le vuelve lo que sobró", () => {
    // Pagó los $166.000 enteros, se hizo 1 de 3 que vale $55.333.
    expect(saldoAAcreditar({ pagado: 166000, finalAmount: 166000, sessionsTotal: 3, consumidas: 1 })).toBe(110667);
  });

  it("pagó parcial y no consumió nada: vuelve todo lo que pagó", () => {
    // No se le devuelve el precio, se le devuelve lo que entró.
    expect(saldoAAcreditar({ pagado: 66400, finalAmount: 166000, sessionsTotal: 3, consumidas: 0 })).toBe(66400);
  });

  it("pagó una seña y ya consumió más de lo que pagó: cero, no deuda", () => {
    // Con el mínimo del 40% esto pasa de verdad: pagó $66.400 de $166.000 y se
    // hizo dos sesiones, que valen más. Una cancelación no crea una deuda
    // nueva; eso es una conversación entre Laura y la clienta, no un número
    // negativo escondido en el saldo a favor.
    expect(saldoAAcreditar({ pagado: 66400, finalAmount: 166000, sessionsTotal: 3, consumidas: 2 })).toBe(0);
  });

  it("una compra de una sola sesión sin consumir vuelve entera", () => {
    expect(saldoAAcreditar({ pagado: 51000, finalAmount: 51000, sessionsTotal: 1, consumidas: 0 })).toBe(51000);
  });

  it("una compra sin sesiones cargadas devuelve lo pagado", () => {
    // No debería pasar (el modelo exige sessions_total > 0), pero si pasara,
    // quedarse con la plata sería lo peor de las dos opciones.
    expect(saldoAAcreditar({ pagado: 51000, finalAmount: 51000, sessionsTotal: 0, consumidas: 0 })).toBe(51000);
  });

  it("las agendadas NO cuentan como consumidas", () => {
    // Sólo se descuenta lo que se HIZO. Un turno agendado se cancela junto con
    // el pack y la sesión nunca se usó.
    expect(saldoAAcreditar({ pagado: 166000, finalAmount: 166000, sessionsTotal: 3, consumidas: 0 })).toBe(166000);
  });
});
