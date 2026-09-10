import { describe, expect, it } from "vitest";
import { type ComboComparable, combosDuplicados, huellaDeCombo } from "./combo-duplicado";

const ESTETICA = "aaaaaaaa-0000-0000-0000-000000000001";
const MASAJES = "aaaaaaaa-0000-0000-0000-000000000002";
const LIMPIEZA = "5e111111-0000-0000-0000-000000000001";
const PEELING = "5e111111-0000-0000-0000-000000000002";
const MASAJE = "5e111111-0000-0000-0000-000000000003";

function combo(over: Partial<ComboComparable> = {}): ComboComparable {
  return {
    id: "c1",
    name: "Facial Completo",
    areaCategoryId: ESTETICA,
    kind: "combo",
    packOfComboId: null,
    packSessions: null,
    serviceIds: [LIMPIEZA, PEELING],
    ...over,
  };
}

function pack(over: Partial<ComboComparable> = {}): ComboComparable {
  return combo({
    id: "p1",
    name: "Facial × 4",
    kind: "pack",
    packOfComboId: "c1",
    packSessions: 4,
    serviceIds: [],
    ...over,
  });
}

describe("huellaDeCombo", () => {
  it("no depende del orden en que se cargaron los servicios", () => {
    expect(huellaDeCombo(combo({ serviceIds: [LIMPIEZA, PEELING] }))).toBe(
      huellaDeCombo(combo({ serviceIds: [PEELING, LIMPIEZA] })),
    );
  });

  it("ignora el nombre y el precio: el duplicado suele venir escrito distinto", () => {
    expect(huellaDeCombo(combo({ id: "c1", name: "Facial Completo" }))).toBe(
      huellaDeCombo(combo({ id: "c2", name: "Combo Facial" })),
    );
  });

  it("separa por área: el mismo combo en dos áreas son dos productos", () => {
    expect(huellaDeCombo(combo({ areaCategoryId: ESTETICA }))).not.toBe(
      huellaDeCombo(combo({ areaCategoryId: MASAJES })),
    );
  });

  it("un combo y un pack nunca comparten huella", () => {
    expect(huellaDeCombo(combo({ serviceIds: [LIMPIEZA] }))).not.toBe(
      huellaDeCombo(pack({ packOfComboId: null, serviceIds: [LIMPIEZA], packSessions: 4 })),
    );
  });
});

describe("combosDuplicados", () => {
  it("encuentra el que ya existe con los mismos servicios", () => {
    const existente = combo({ id: "c1", name: "Facial Completo" });
    const nuevo = combo({ id: "nuevo", name: "Combo Facial", serviceIds: [PEELING, LIMPIEZA] });
    expect(combosDuplicados(nuevo, [existente]).map((c) => c.id)).toEqual(["c1"]);
  });

  it("no avisa si le falta o le sobra un servicio", () => {
    const existente = combo({ id: "c1", serviceIds: [LIMPIEZA, PEELING] });
    const nuevo = combo({ id: "nuevo", serviceIds: [LIMPIEZA, PEELING, MASAJE] });
    expect(combosDuplicados(nuevo, [existente])).toEqual([]);
  });

  it("no se avisa a sí mismo al editarle el precio a uno guardado", () => {
    const guardado = combo({ id: "c1" });
    expect(combosDuplicados(guardado, [guardado])).toEqual([]);
  });

  it("dos packs del mismo combo con distinta repetición NO son duplicados", () => {
    const de3 = pack({ id: "p1", packSessions: 3 });
    const de5 = pack({ id: "p2", packSessions: 5 });
    expect(combosDuplicados(de5, [de3])).toEqual([]);
  });

  it("dos packs del mismo combo con la MISMA repetición sí lo son", () => {
    const existente = pack({ id: "p1", packSessions: 4 });
    const nuevo = pack({ id: "p2", name: "Pack Facial 4", packSessions: 4 });
    expect(combosDuplicados(nuevo, [existente]).map((c) => c.id)).toEqual(["p1"]);
  });

  it("un pack de un servicio suelto se compara por su servicio", () => {
    const existente = pack({ id: "p1", packOfComboId: null, serviceIds: [LIMPIEZA], packSessions: 5 });
    const nuevo = pack({ id: "p2", packOfComboId: null, serviceIds: [LIMPIEZA], packSessions: 5 });
    expect(combosDuplicados(nuevo, [existente]).map((c) => c.id)).toEqual(["p1"]);
  });

  it("un pack de un combo y uno de un servicio no se confunden", () => {
    const deCombo = pack({ id: "p1", packOfComboId: "c1", serviceIds: [], packSessions: 4 });
    const deServicio = pack({ id: "p2", packOfComboId: null, serviceIds: [LIMPIEZA], packSessions: 4 });
    expect(combosDuplicados(deServicio, [deCombo])).toEqual([]);
  });

  it("devuelve todos los duplicados si ya se coló más de uno", () => {
    const a = combo({ id: "c1" });
    const b = combo({ id: "c2", name: "Otro nombre" });
    const nuevo = combo({ id: "nuevo" });
    expect(combosDuplicados(nuevo, [a, b]).map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
