import { describe, expect, it } from "vitest";
import { nivelDeStock, insumosParaAvisar } from "./stock";

describe("nivelDeStock", () => {
  it("por encima del mínimo está ok", () => {
    expect(nivelDeStock(10, 3)).toBe("ok");
  });

  it("justo en el mínimo ya avisa", () => {
    // El mínimo es "avisame cuando llegues acá", no "avisame cuando lo pases".
    // Si esto fuera "ok", el aviso llegaría siempre un consumo tarde.
    expect(nivelDeStock(3, 3)).toBe("bajo");
  });

  it("por debajo del mínimo está bajo", () => {
    expect(nivelDeStock(2, 3)).toBe("bajo");
  });

  it("en cero no hay stock", () => {
    expect(nivelDeStock(0, 3)).toBe("sin_stock");
  });

  it("en negativo tampoco: se consumió más de lo que había", () => {
    // Pasa de verdad: al completar un servicio se descuenta aunque no alcance
    // (decisión de Laura, 2026-09-08). El número negativo es el dato real.
    expect(nivelDeStock(-4, 3)).toBe("sin_stock");
  });

  it("sin mínimo cargado sólo distingue si hay o no hay", () => {
    // La mayoría de los insumos van a entrar sin mínimo. Inventar uno haría
    // que la pantalla mienta con alertas que nadie configuró.
    expect(nivelDeStock(1, null)).toBe("ok");
    expect(nivelDeStock(500, null)).toBe("ok");
    expect(nivelDeStock(0, null)).toBe("sin_stock");
  });

  it("sin stock cargado no se puede decir nada", () => {
    expect(nivelDeStock(null, 3)).toBe("desconocido");
    expect(nivelDeStock(null, null)).toBe("desconocido");
  });

  it("un mínimo en cero no dispara aviso teniendo unidades", () => {
    // mínimo 0 = "no me avises". Sin este caso, cualquier insumo con mínimo 0
    // quedaría en 'bajo' apenas toque el piso y la alerta perdería sentido.
    expect(nivelDeStock(5, 0)).toBe("ok");
    expect(nivelDeStock(0, 0)).toBe("sin_stock");
  });
});

describe("insumosParaAvisar", () => {
  const insumos = [
    { id: "1", name: "Guantes", quantityInStock: 100, minimumStock: 20 },
    { id: "2", name: "Gasas", quantityInStock: 5, minimumStock: 10 },
    { id: "3", name: "Ampollas", quantityInStock: 0, minimumStock: 2 },
    { id: "4", name: "Alcohol", quantityInStock: 3, minimumStock: null },
    { id: "5", name: "Algodón", quantityInStock: null, minimumStock: 5 },
  ];

  it("devuelve sólo los que están bajos o sin stock", () => {
    expect(insumosParaAvisar(insumos).map((i) => i.name)).toEqual(["Ampollas", "Gasas"]);
  });

  it("los que no tienen stock cargado no se avisan", () => {
    // 'desconocido' no es una alerta: es un insumo a medio cargar.
    expect(insumosParaAvisar(insumos).some((i) => i.name === "Algodón")).toBe(false);
  });

  it("pone primero los que no tienen nada", () => {
    // El orden es la prioridad: sin stock frena un tratamiento hoy, bajo no.
    expect(insumosParaAvisar(insumos)[0]!.name).toBe("Ampollas");
  });

  it("sin insumos para avisar devuelve lista vacía, no null", () => {
    expect(insumosParaAvisar([{ id: "1", name: "Guantes", quantityInStock: 99, minimumStock: 1 }])).toEqual([]);
  });
});
