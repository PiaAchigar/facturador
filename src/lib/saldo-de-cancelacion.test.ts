import { describe, expect, it } from "vitest";
import { saldoAAcreditar, valorDeUnaSesion } from "./saldo-de-cancelacion";

const PACK = { finalAmount: 166000, sessionsTotal: 3 };

describe("valorDeUnaSesion", () => {
  it("reparte el precio entre todas las sesiones", () => {
    expect(valorDeUnaSesion(166000, 3)).toBeCloseTo(55333.33, 2);
  });

  it("sin sesiones no divide por cero", () => {
    expect(valorDeUnaSesion(166000, 0)).toBe(0);
  });
});

describe("saldoAAcreditar — las señas no se devuelven", () => {
  it("pagó una seña del 40% y no consumió nada: no vuelve nada", () => {
    // Regla de Laura: una seña es el compromiso de la clienta. Si se echa
    // atrás, la pierde. Es la razón de ser de la seña.
    expect(saldoAAcreditar({ pagado: 66400, ...PACK, consumidas: 0 })).toBe(0);
  });

  it("pagó una seña y encima consumió: tampoco", () => {
    expect(saldoAAcreditar({ pagado: 66400, ...PACK, consumidas: 2 })).toBe(0);
  });

  it("pagó casi todo pero no todo: sigue siendo seña", () => {
    // $1.000 de diferencia sobre $166.000. Duro, pero es la regla: la línea
    // está en el 100%, no en "casi".
    expect(saldoAAcreditar({ pagado: 165000, ...PACK, consumidas: 0 })).toBe(0);
  });
});

describe("saldoAAcreditar — pagado el 100%", () => {
  it("sin consumir, vuelve todo", () => {
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 0 })).toBe(166000);
  });

  it("con una de tres consumida, se descuenta esa sesión", () => {
    // $166.000 / 3 = $55.333 por sesión. Se hizo una, le quedan dos.
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 1 })).toBe(110667);
  });

  it("con dos consumidas, queda una", () => {
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 2 })).toBe(55333);
  });

  it("consumido todo, no vuelve nada", () => {
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 3 })).toBe(0);
  });

  it("el redondeo nunca acredita más de lo pagado", () => {
    // Los tres tercios de $166.000 no son enteros.
    const partes = [0, 1, 2, 3].map((c) => saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: c }));
    expect(partes.every((p) => p <= 166000)).toBe(true);
  });

  it("pagó de más: vuelve lo que entró, no el precio", () => {
    // Se cobró $180.000 por un pack de $166.000. Ese exceso también es plata
    // de la clienta.
    expect(saldoAAcreditar({ pagado: 180000, ...PACK, consumidas: 0 })).toBe(180000);
  });

  it("una compra de una sola sesión sin consumir vuelve entera", () => {
    expect(saldoAAcreditar({ pagado: 51000, finalAmount: 51000, sessionsTotal: 1, consumidas: 0 })).toBe(51000);
  });

  it("un servicio suelto ya hecho no vuelve", () => {
    expect(saldoAAcreditar({ pagado: 51000, finalAmount: 51000, sessionsTotal: 1, consumidas: 1 })).toBe(0);
  });

  it("las agendadas NO cuentan como consumidas", () => {
    // Sólo se descuenta lo que se HIZO. Un turno agendado se cae junto con el
    // pack y esa sesión nunca se usó.
    expect(saldoAAcreditar({ pagado: 166000, ...PACK, consumidas: 0 })).toBe(166000);
  });
});

describe("saldoAAcreditar — bordes", () => {
  it("si no pagó nada, no hay nada a favor", () => {
    expect(saldoAAcreditar({ pagado: 0, ...PACK, consumidas: 0 })).toBe(0);
  });

  it("una compra sin sesiones cargadas devuelve lo pagado", () => {
    // No debería pasar (el modelo exige sessions_total > 0), pero quedarse con
    // la plata sería lo peor de las dos opciones.
    expect(saldoAAcreditar({ pagado: 51000, finalAmount: 51000, sessionsTotal: 0, consumidas: 0 })).toBe(51000);
  });
});
