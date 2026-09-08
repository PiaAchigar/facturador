import { describe, expect, it } from "vitest";
import { planDeConsumo } from "./consumo";

const gasas = { productId: "gasas", name: "Gasas", quantity: 2, quantityInStock: 10, isActive: true };
const guantes = { productId: "guantes", name: "Guantes", quantity: 1, quantityInStock: 3, isActive: true };

describe("planDeConsumo", () => {
  it("descuenta la cantidad de la receta de cada insumo", () => {
    const p = planDeConsumo([gasas, guantes]);
    expect(p.descontar).toEqual([
      { productId: "gasas", name: "Gasas", quantity: 2, stockAntes: 10, stockDespues: 8 },
      { productId: "guantes", name: "Guantes", quantity: 1, stockAntes: 3, stockDespues: 2 },
    ]);
  });

  it("un servicio sin receta no descuenta nada", () => {
    expect(planDeConsumo([])).toEqual({ descontar: [], faltantes: [], omitidos: [] });
  });

  it("descuenta fracciones sin redondear", () => {
    // Media ampolla es media ampolla. Redondear haría que el stock se desviara
    // solo, un poquito por cada servicio.
    const p = planDeConsumo([
      { productId: "amp", name: "Ampolla", quantity: 0.5, quantityInStock: 10, isActive: true },
    ]);
    expect(p.descontar[0]!.stockDespues).toBe(9.5);
  });

  it("no bloquea cuando no alcanza: descuenta igual y avisa", () => {
    // Decisión de Laura (2026-09-08): bloquear un turno ya hecho por un dato de
    // inventario mal cargado le frena la caja.
    const p = planDeConsumo([{ ...gasas, quantityInStock: 1 }]);
    expect(p.descontar[0]!.stockDespues).toBe(-1);
    expect(p.faltantes.map((f) => f.productId)).toEqual(["gasas"]);
  });

  it("quedar exactamente en cero no es un faltante", () => {
    // Se usó lo último que había, y eso no es un error. La pantalla de Insumos
    // ya lo muestra como "Sin stock" para que se reponga.
    const p = planDeConsumo([{ ...gasas, quantityInStock: 2 }]);
    expect(p.descontar[0]!.stockDespues).toBe(0);
    expect(p.faltantes).toEqual([]);
  });

  it("un insumo sin stock cargado se descuenta igual y avisa distinto", () => {
    // 'null' es "nadie lo contó todavía". Dejarlo en null haría que el
    // descuento no hiciera nada y la función entera sería mentira; ponerlo en
    // negativo lo hace visible y obliga a cargar el número real.
    const p = planDeConsumo([{ ...gasas, quantityInStock: null }]);
    expect(p.descontar[0]!.stockDespues).toBe(-2);
    expect(p.faltantes[0]!.stockAntes).toBeNull();
  });

  it("un insumo archivado no se descuenta, se informa aparte", () => {
    // Se archivó porque ya no se usa. Seguir descontándolo movería el stock de
    // algo que nadie compra.
    const p = planDeConsumo([{ ...gasas, isActive: false }, guantes]);
    expect(p.descontar.map((d) => d.productId)).toEqual(["guantes"]);
    expect(p.omitidos.map((o) => o.productId)).toEqual(["gasas"]);
    expect(p.faltantes).toEqual([]);
  });

  it("una cantidad no positiva se ignora, no suma stock", () => {
    // La base tiene un CHECK > 0, pero si entrara por otro lado sumaría stock
    // en cada servicio.
    const p = planDeConsumo([{ ...gasas, quantity: 0 }, { ...guantes, quantity: -5 }]);
    expect(p.descontar).toEqual([]);
    expect(p.omitidos).toHaveLength(2);
  });

  it("informa varios faltantes juntos, los más negativos primero", () => {
    // El aviso muestra los primeros: que arranque por el que está peor.
    const p = planDeConsumo([
      { ...gasas, quantityInStock: 1 },
      { ...guantes, quantity: 10, quantityInStock: 3 },
    ]);
    expect(p.faltantes.map((f) => f.productId)).toEqual(["guantes", "gasas"]);
  });
});
