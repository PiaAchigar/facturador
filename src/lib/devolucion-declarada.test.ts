import { describe, expect, it } from "vitest";
import { comprobantesDeDevolucion, repartirDevolucion } from "./devolucion-declarada";

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

describe("comprobantesDeDevolucion", () => {
  it("devolución parcial: la nota va por el TOTAL y se refactura la diferencia", () => {
    // El caso real: pack de 3 por $76.000, usó una sesión, se le devuelven
    // $50.667. La nota igual acredita los $76.000 y se refacturan $25.333.
    expect(comprobantesDeDevolucion(76000, 50667)).toEqual({
      notaPor: 76000,
      refacturaPor: 25333,
    });
  });

  it("devolución total: nota por el total y nada que refacturar", () => {
    expect(comprobantesDeDevolucion(76000, 76000)).toEqual({
      notaPor: 76000,
      refacturaPor: 0,
    });
  });

  it("la nota NUNCA es por lo devuelto: un CAE no se acredita a medias", () => {
    const r = comprobantesDeDevolucion(100000, 1);
    expect(r.notaPor).toBe(100000);
  });

  it("nota + refactura reconstruyen la factura original", () => {
    const r = comprobantesDeDevolucion(76000, 50667);
    expect(r.notaPor - r.refacturaPor).toBe(50667);
  });

  it("devolver más de lo facturado no genera una refactura negativa", () => {
    expect(comprobantesDeDevolucion(50000, 80000).refacturaPor).toBe(0);
  });

  it("sin factura no hay comprobantes", () => {
    expect(comprobantesDeDevolucion(0, 5000)).toEqual({ notaPor: 0, refacturaPor: 0 });
  });
});
