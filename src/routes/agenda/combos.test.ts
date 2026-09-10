import { describe, expect, it } from "vitest";
import { comboBody, combosRouter } from "./combos";

const AREA = "aaaaaaaa-1111-1111-1111-111111111111";
const LIMPIEZA = "11111111-1111-1111-1111-111111111111";
const PEELING = "22222222-2222-2222-2222-222222222222";
const COMBO = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const valido = {
  name: "Depilación cuerpo completo",
  priceType: "fixed" as const,
  fixedPrice: 120000,
  validityMonths: 12,
  areaCategoryId: AREA,
  lines: [{ serviceId: LIMPIEZA, sessionsIncluded: 8 }],
};

/** Un pack que repite un combo: sin renglones propios. */
const packValido = {
  name: "Facial × 4",
  priceType: "percentage" as const,
  discountPercentage: 0,
  validityMonths: 12,
  areaCategoryId: AREA,
  kind: "pack" as const,
  packOfComboId: COMBO,
  packSessions: 4,
  lines: [],
};

describe("comboBody", () => {
  it("acepta un combo válido", () => {
    expect(comboBody.safeParse(valido).success).toBe(true);
  });

  it("rechaza un combo sin líneas: un combo sin servicios no es nada", () => {
    const r = comboBody.safeParse({ ...valido, lines: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/al menos un servicio/i);
  });

  it("rechaza sessions_included en 0", () => {
    const r = comboBody.safeParse({
      ...valido,
      lines: [{ serviceId: "11111111-1111-1111-1111-111111111111", sessionsIncluded: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza sessions_included no entero, con mensaje en castellano", () => {
    const r = comboBody.safeParse({
      ...valido,
      lines: [{ serviceId: "11111111-1111-1111-1111-111111111111", sessionsIncluded: 2.5 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/entero/i);
      expect(r.error.issues[0]?.message).not.toMatch(/expected|received|float/i);
    }
  });

  it("rechaza sessionsIncluded por encima del tope, con mensaje en castellano", () => {
    const r = comboBody.safeParse({
      ...valido,
      lines: [
        { serviceId: "11111111-1111-1111-1111-111111111111", sessionsIncluded: 99999999999 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/no pueden superar/i);
      expect(r.error.issues[0]?.message).not.toMatch(/less than or equal/i);
    }
  });

  it("acepta sessionsIncluded justo en el tope (999)", () => {
    const r = comboBody.safeParse({
      ...valido,
      lines: [{ serviceId: "11111111-1111-1111-1111-111111111111", sessionsIncluded: 999 }],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza priceType 'fixed' sin fixedPrice", () => {
    const { fixedPrice: _, ...sinPrecio } = valido;
    const r = comboBody.safeParse(sinPrecio);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/precio/i);
  });

  it("rechaza priceType 'percentage' sin discountPercentage", () => {
    const { fixedPrice: _, ...resto } = valido;
    const r = comboBody.safeParse({ ...resto, priceType: "percentage" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/porcentaje/i);
  });

  it("acepta 'percentage' con su porcentaje", () => {
    const { fixedPrice: _, ...resto } = valido;
    const r = comboBody.safeParse({ ...resto, priceType: "percentage", discountPercentage: 20 });
    expect(r.success).toBe(true);
  });

  it("rechaza un porcentaje mayor a 100, con mensaje en castellano", () => {
    const { fixedPrice: _, ...resto } = valido;
    const r = comboBody.safeParse({ ...resto, priceType: "percentage", discountPercentage: 150 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/no puede superar el 100/i);
      expect(r.error.issues[0]?.message).not.toMatch(/less than or equal/i);
    }
  });

  it("rechaza un porcentaje negativo, con mensaje en castellano", () => {
    const { fixedPrice: _, ...resto } = valido;
    const r = comboBody.safeParse({ ...resto, priceType: "percentage", discountPercentage: -5 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/no puede ser negativo/i);
  });

  it("rechaza un fixedPrice negativo, con mensaje en castellano", () => {
    const r = comboBody.safeParse({ ...valido, fixedPrice: -100 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/no puede ser negativo/i);
  });

  it("rechaza validityMonths en 0", () => {
    expect(comboBody.safeParse({ ...valido, validityMonths: 0 }).success).toBe(false);
  });

  it("rechaza validityMonths no entero, con mensaje en castellano", () => {
    const r = comboBody.safeParse({ ...valido, validityMonths: 3.5 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/entero/i);
      expect(r.error.issues[0]?.message).not.toMatch(/expected|received|float/i);
    }
  });

  it("rechaza un nombre de más de 200 caracteres, con mensaje en castellano", () => {
    const r = comboBody.safeParse({ ...valido, name: "a".repeat(201) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/no puede superar los 200/i);
      expect(r.error.issues[0]?.message).not.toMatch(/string must contain/i);
    }
  });

  it("rechaza una descripción de más de 2000 caracteres, con mensaje en castellano", () => {
    const r = comboBody.safeParse({ ...valido, description: "a".repeat(2001) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/no puede superar los 2000/i);
      expect(r.error.issues[0]?.message).not.toMatch(/string must contain/i);
    }
  });

  it("rechaza displayOrder no entero, con mensaje en castellano", () => {
    const r = comboBody.safeParse({ ...valido, displayOrder: 1.5 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/entero/i);
      expect(r.error.issues[0]?.message).not.toMatch(/expected|received|float/i);
    }
  });

  it("rechaza displayOrder negativo, con mensaje en castellano", () => {
    const r = comboBody.safeParse({ ...valido, displayOrder: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/no puede ser negativo/i);
  });

  it("rechaza el mismo servicio dos veces en el mismo combo", () => {
    const r = comboBody.safeParse({
      ...valido,
      lines: [
        { serviceId: LIMPIEZA, sessionsIncluded: 8 },
        { serviceId: LIMPIEZA, sessionsIncluded: 4 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => /repetido/i.test(i.message))).toBe(true);
  });
});

// ── 1.50.0 ─────────────────────────────────────────────────────────────────

describe("comboBody — el área (1.50.0)", () => {
  it("rechaza un combo sin área: se elige, no se deduce de los servicios", () => {
    const { areaCategoryId: _, ...sinArea } = valido;
    const r = comboBody.safeParse(sinArea);
    expect(r.success).toBe(false);
  });

  it("rechaza un área que no es un uuid, con mensaje en castellano", () => {
    const r = comboBody.safeParse({ ...valido, areaCategoryId: "Estética" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/elegir un área/i);
  });
});

describe("comboBody — sessionsIncluded ya no hace falta (spec §4.3)", () => {
  it("una línea sin sesiones vale 1: el combo es UNA sesión de cada servicio", () => {
    const r = comboBody.safeParse({ ...valido, lines: [{ serviceId: LIMPIEZA }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lines[0]?.sessionsIncluded).toBe(1);
  });
});

describe("comboBody — packs (1.50.0)", () => {
  it("acepta un pack que repite un combo, sin renglones propios", () => {
    expect(comboBody.safeParse(packValido).success).toBe(true);
  });

  it("acepta un pack de servicios sueltos, sin combo al que apuntar", () => {
    const { packOfComboId: _, ...resto } = packValido;
    const r = comboBody.safeParse({ ...resto, lines: [{ serviceId: LIMPIEZA }] });
    expect(r.success).toBe(true);
  });

  it("rechaza un pack sin repeticiones", () => {
    const { packSessions: _, ...sinN } = packValido;
    const r = comboBody.safeParse(sinN);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /cuántas veces se repite/i.test(i.message))).toBe(true);
    }
  });

  it("rechaza un pack que repite una sola vez: eso es el combo", () => {
    const r = comboBody.safeParse({ ...packValido, packSessions: 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/al menos 2 veces/i);
  });

  it("rechaza un COMBO con campos de pack: si querés repetirlo, armá un pack", () => {
    const r = comboBody.safeParse({ ...valido, packSessions: 4 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /armá un pack/i.test(i.message))).toBe(true);
    }
  });

  it("rechaza un pack marcado como 'se hacen juntos': eso lo dice el combo", () => {
    const r = comboBody.safeParse({ ...packValido, servicesTogether: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /lo dice el combo/i.test(i.message))).toBe(true);
    }
  });

  it("rechaza medio descuento propio: hace falta el porcentaje Y el redondeo", () => {
    const r = comboBody.safeParse({ ...packValido, packDiscountPercentage: 20 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /porcentaje Y el redondeo/i.test(i.message))).toBe(true);
    }
  });

  it("acepta el descuento propio completo", () => {
    const r = comboBody.safeParse({
      ...packValido,
      packDiscountPercentage: 20,
      packRoundingBase: 500,
    });
    expect(r.success).toBe(true);
  });

  it("acepta un descuento propio en CERO, que es un pack sin rebaja", () => {
    const r = comboBody.safeParse({
      ...packValido,
      packDiscountPercentage: 0,
      packRoundingBase: 1,
    });
    expect(r.success).toBe(true);
  });
});

describe("comboBody — se hacen juntos (§4.4)", () => {
  it("acepta un combo de dos servicios marcado como juntos", () => {
    const r = comboBody.safeParse({
      ...valido,
      servicesTogether: true,
      lines: [{ serviceId: LIMPIEZA }, { serviceId: PEELING }],
    });
    expect(r.success).toBe(true);
  });

  it("por defecto NO viene marcado: ante un descuido, la opción más libre", () => {
    const r = comboBody.safeParse({
      ...valido,
      lines: [{ serviceId: LIMPIEZA }, { serviceId: PEELING }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.servicesTogether ?? false).toBe(false);
  });

  it("rechaza 'juntos' con un solo servicio: no hay nada que juntar", () => {
    const r = comboBody.safeParse({ ...valido, servicesTogether: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /al menos dos servicios/i.test(i.message))).toBe(true);
    }
  });
});

describe("el orden de las rutas", () => {
  /**
   * Hono resuelve por ORDEN DE REGISTRO. Si `/admin/:id` se registra antes que
   * `/admin/tarifarios`, un GET a tarifarios entra por el comodín con
   * id="tarifarios" y devuelve un 404 de combo inexistente — sin error, sin
   * aviso, simplemente la pantalla vacía. Ya pasó con `/credits/expired` en las
   * rutas de saldos, así que acá queda fijado.
   */
  it("las rutas de path fijo van ANTES del comodín /admin/:id", () => {
    const gets = combosRouter.routes.filter((r) => r.method === "GET").map((r) => r.path);
    const comodin = gets.indexOf("/admin/:id");
    const tarifarios = gets.indexOf("/admin/tarifarios");

    expect(comodin).toBeGreaterThanOrEqual(0);
    expect(tarifarios).toBeGreaterThanOrEqual(0);
    expect(tarifarios).toBeLessThan(comodin);
  });
});
