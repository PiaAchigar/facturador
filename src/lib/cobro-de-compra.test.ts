import { describe, expect, it } from "vitest";
import { MINIMO_PRIMER_PAGO, cobroDeCompra, razonesParaNoCobrar } from "./cobro-de-compra";

const compra = { finalAmount: 166000, yaPagado: 0 };

describe("cobroDeCompra", () => {
  it("el mínimo del primer pago es el 40%", () => {
    expect(MINIMO_PRIMER_PAGO).toBe(0.4);
    expect(cobroDeCompra(compra).minimo).toBe(66400);
  });

  it("sugiere el total: es lo más común", () => {
    expect(cobroDeCompra(compra).sugerido).toBe(166000);
  });

  it("dice cuánto falta cobrar", () => {
    expect(cobroDeCompra({ finalAmount: 166000, yaPagado: 66400 }).pendiente).toBe(99600);
  });

  it("con el saldo a favor ya cubriendo el 40%, no queda mínimo", () => {
    // El saldo cubrió $110.667: la clienta ya puso mucho más que el 40%.
    const c = cobroDeCompra({ finalAmount: 166000, yaPagado: 110667 });
    expect(c.pendiente).toBe(55333);
    expect(c.minimo).toBe(0);
  });

  it("el mínimo es sobre el ACUMULADO, no sobre este pago", () => {
    // El agujero que cierra: con un saldo de $1.000 aplicado antes, mirar
    // "¿es el primer pago?" daría que no, y el 40% se esquivaría entero.
    const c = cobroDeCompra({ finalAmount: 166000, yaPagado: 1000 });
    expect(c.minimo).toBe(65400); // 66.400 − 1.000
  });

  it("si ya está paga, no hay nada que cobrar", () => {
    const c = cobroDeCompra({ finalAmount: 166000, yaPagado: 166000 });
    expect(c).toMatchObject({ pendiente: 0, minimo: 0, sugerido: 0 });
  });

  it("el mínimo se redondea al peso", () => {
    expect(cobroDeCompra({ finalAmount: 51000, yaPagado: 0 }).minimo).toBe(20400);
  });
});

describe("razonesParaNoCobrar", () => {
  const ctx = { finalAmount: 166000, yaPagado: 0 };

  it("el total se acepta", () => {
    expect(razonesParaNoCobrar(166000, ctx)).toEqual([]);
  });

  it("el 40% exacto se acepta", () => {
    expect(razonesParaNoCobrar(66400, ctx)).toEqual([]);
  });

  it("más del 40% se acepta: no hay tope", () => {
    expect(razonesParaNoCobrar(120000, ctx)).toEqual([]);
  });

  it("menos del 40% se rechaza y dice cuánto es", () => {
    expect(razonesParaNoCobrar(50000, ctx)).toEqual([
      "el primer pago tiene que ser de al menos $66.400 (el 40% de $166.000)",
    ]);
  });

  it("cobrar más de lo que se debe se rechaza", () => {
    // Dejaría un pago de más que después habría que devolver.
    expect(razonesParaNoCobrar(200000, ctx)).toEqual([
      "no se puede cobrar más de lo que falta ($166.000)",
    ]);
  });

  it("cero o negativo no es un cobro", () => {
    expect(razonesParaNoCobrar(0, ctx)).toEqual(["el monto tiene que ser mayor a cero"]);
    expect(razonesParaNoCobrar(-100, ctx)).toEqual(["el monto tiene que ser mayor a cero"]);
  });

  it("alcanzado el 40%, se salda de a lo que se pueda", () => {
    // El mínimo es para llegar al 40%. Después no hay piso: exigirlo en cada
    // pago haría imposible cerrar una compra a la que le faltan mil pesos.
    expect(razonesParaNoCobrar(1000, { finalAmount: 166000, yaPagado: 66400 })).toEqual([]);
  });

  it("una compra ya paga no se puede cobrar de nuevo", () => {
    expect(razonesParaNoCobrar(1000, { finalAmount: 166000, yaPagado: 166000 })).toEqual([
      "esta compra ya está paga",
    ]);
  });
});
