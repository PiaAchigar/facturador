import { describe, expect, it } from "vitest";
import { repartirDevolucion } from "./devolucion-declarada";

describe("repartirDevolucion", () => {
  it("cobrado con factura: la devolución sale declarada", () => {
    expect(repartirDevolucion(110667, [{ amount: 166000, isDeclared: true }])).toEqual({
      declarado: 110667,
      noDeclarado: 0,
    });
  });

  it("cobrado con recibo: la devolución NO se declara", () => {
    // El bug: declararla dejaba un egreso declarado que ningún ingreso
    // declarado compensaba, y la rendición del día se iba a negativo.
    expect(repartirDevolucion(86000, [{ amount: 86000, isDeclared: false }])).toEqual({
      declarado: 0,
      noDeclarado: 86000,
    });
  });

  it("cobro mixto: reparte en la misma proporción", () => {
    const r = repartirDevolucion(100000, [
      { amount: 60000, isDeclared: true },
      { amount: 40000, isDeclared: false },
    ]);
    expect(r).toEqual({ declarado: 60000, noDeclarado: 40000 });
  });

  it("las dos partes suman SIEMPRE lo devuelto, aunque el reparto no sea redondo", () => {
    // Con dos redondeos independientes acá faltaba un peso en la caja.
    const r = repartirDevolucion(100000, [
      { amount: 33333, isDeclared: true },
      { amount: 66667, isDeclared: false },
    ]);
    expect(r.declarado + r.noDeclarado).toBe(100000);
  });

  it("isDeclared en null cuenta como no declarado", () => {
    expect(repartirDevolucion(5000, [{ amount: 5000, isDeclared: null }])).toEqual({
      declarado: 0,
      noDeclarado: 5000,
    });
  });

  it("sin cobros registrados, no se declara nada", () => {
    // Declarar de más un egreso ensucia la rendición; de menos, no.
    expect(repartirDevolucion(5000, [])).toEqual({ declarado: 0, noDeclarado: 5000 });
  });

  it("devolver cero no mueve nada", () => {
    expect(repartirDevolucion(0, [{ amount: 100, isDeclared: true }])).toEqual({
      declarado: 0,
      noDeclarado: 0,
    });
  });
});
