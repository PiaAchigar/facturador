import { describe, expect, it } from "vitest";
import { costoDeReceta, diffReceta, normalizarReceta } from "./receta";

describe("normalizarReceta", () => {
  it("deja pasar las líneas con cantidad", () => {
    expect(normalizarReceta([{ productId: "p1", quantity: 2 }])).toEqual([
      { productId: "p1", quantity: 2 },
    ]);
  });

  it("descarta las de cantidad 0", () => {
    // Tildar un insumo y dejar la cantidad en 0 es no usarlo. Guardarlo haría
    // que el servicio dijera que lleva un insumo del que no descuenta nada.
    expect(normalizarReceta([{ productId: "p1", quantity: 0 }])).toEqual([]);
  });

  it("descarta las negativas", () => {
    // Una cantidad negativa SUMARÍA stock cada vez que se hace el servicio.
    expect(normalizarReceta([{ productId: "p1", quantity: -3 }])).toEqual([]);
  });

  it("descarta las que no tienen cantidad cargada", () => {
    expect(normalizarReceta([{ productId: "p1", quantity: null }])).toEqual([]);
  });

  it("acepta fracciones: media ampolla es media ampolla", () => {
    expect(normalizarReceta([{ productId: "p1", quantity: 0.5 }])).toEqual([
      { productId: "p1", quantity: 0.5 },
    ]);
  });

  it("con el mismo insumo dos veces se queda con la última", () => {
    // La pantalla no debería mandarlo repetido, pero si pasa, insertar dos
    // filas rompería el índice único y perdería el guardado entero.
    expect(
      normalizarReceta([
        { productId: "p1", quantity: 2 },
        { productId: "p1", quantity: 5 },
      ]),
    ).toEqual([{ productId: "p1", quantity: 5 }]);
  });
});

describe("diffReceta", () => {
  const actual = [
    { productId: "gasas", quantity: 2 },
    { productId: "guantes", quantity: 1 },
  ];

  it("sin cambios no toca nada", () => {
    expect(diffReceta(actual, actual)).toEqual({ agregar: [], actualizar: [], borrar: [] });
  });

  it("un insumo nuevo se agrega", () => {
    const d = diffReceta(actual, [...actual, { productId: "alcohol", quantity: 3 }]);
    expect(d.agregar).toEqual([{ productId: "alcohol", quantity: 3 }]);
    expect(d.actualizar).toEqual([]);
    expect(d.borrar).toEqual([]);
  });

  it("un insumo destildado se borra", () => {
    const d = diffReceta(actual, [{ productId: "gasas", quantity: 2 }]);
    expect(d.borrar).toEqual(["guantes"]);
  });

  it("cambiar la cantidad actualiza, no borra y recrea", () => {
    // Borrar y recrear perdería el `created_at`, que es lo único que dice desde
    // cuándo ese servicio usa ese insumo.
    const d = diffReceta(actual, [
      { productId: "gasas", quantity: 4 },
      { productId: "guantes", quantity: 1 },
    ]);
    expect(d.actualizar).toEqual([{ productId: "gasas", quantity: 4 }]);
    expect(d.agregar).toEqual([]);
    expect(d.borrar).toEqual([]);
  });

  it("vaciar la receta borra todo", () => {
    expect(diffReceta(actual, []).borrar).toEqual(["gasas", "guantes"]);
  });

  it("desde vacío todo es alta", () => {
    const d = diffReceta([], actual);
    expect(d.agregar).toHaveLength(2);
    expect(d.borrar).toEqual([]);
  });
});

describe("costoDeReceta", () => {
  it("suma cantidad por costo de cada línea", () => {
    expect(
      costoDeReceta([
        { quantity: 2, unitCost: 100 },
        { quantity: 1, unitCost: 50 },
      ]),
    ).toBe(250);
  });

  it("redondea a dos decimales", () => {
    expect(costoDeReceta([{ quantity: 3, unitCost: 33.333 }])).toBe(100);
  });

  it("una línea sin costo cargado no rompe la suma", () => {
    // Es lo normal al principio: el insumo existe pero nadie le puso precio.
    expect(costoDeReceta([{ quantity: 2, unitCost: 100 }, { quantity: 5, unitCost: null }])).toBe(200);
  });

  it("sin líneas el costo es 0", () => {
    expect(costoDeReceta([])).toBe(0);
  });
});
