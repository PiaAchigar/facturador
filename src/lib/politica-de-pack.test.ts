import { describe, expect, it } from "vitest";
import { politicaDeUnPack } from "./politica-de-pack";
import { precioPack } from "./pack-pricing";

const AREA = { packDiscountPercentage: 15, packRoundingBase: 1000 };

describe("politicaDeUnPack", () => {
  it("las sesiones salen SIEMPRE del pack, no del área", () => {
    const p = politicaDeUnPack(
      { packSessions: 4, packDiscountPercentage: null, packRoundingBase: null },
      AREA,
    );
    expect(p).toEqual({ sesiones: 4, descuentoPct: 15, redondeo: 1000 });
  });

  it("sin descuento propio, cae en el del área", () => {
    const p = politicaDeUnPack(
      { packSessions: 3, packDiscountPercentage: null, packRoundingBase: null },
      AREA,
    );
    expect(p?.descuentoPct).toBe(15);
    expect(p?.redondeo).toBe(1000);
  });

  it("el descuento propio pisa al del área", () => {
    const p = politicaDeUnPack(
      { packSessions: 5, packDiscountPercentage: 25, packRoundingBase: 500 },
      AREA,
    );
    expect(p).toEqual({ sesiones: 5, descuentoPct: 25, redondeo: 500 });
  });

  it("un descuento propio en CERO se respeta, no cae al del área", () => {
    // Con `||` en vez de `??` este pack cobraría 15% menos sin que nadie lo pida.
    const p = politicaDeUnPack(
      { packSessions: 2, packDiscountPercentage: 0, packRoundingBase: 1 },
      AREA,
    );
    expect(p?.descuentoPct).toBe(0);
    expect(p?.redondeo).toBe(1);
  });

  it("sin sesiones no hay pack: devuelve null", () => {
    expect(
      politicaDeUnPack(
        { packSessions: null, packDiscountPercentage: null, packRoundingBase: null },
        AREA,
      ),
    ).toBeNull();
  });
});

describe("el precio que sale de esa política", () => {
  const config = { packSesiones: 3, packDescuentoPct: 15, packRedondeo: 1000 };

  it("un pack de 4 sobre un combo de $10.000 con el 15% del área", () => {
    const p = politicaDeUnPack(
      { packSessions: 4, packDiscountPercentage: null, packRoundingBase: null },
      AREA,
    )!;
    // 10.000 × 4 = 40.000 · −15% = 34.000 · redondeo a 1000 = 34.000
    expect(precioPack(10_000, config, p)).toBe(34_000);
  });

  it("el mismo pack con 25% propio cobra menos", () => {
    const p = politicaDeUnPack(
      { packSessions: 4, packDiscountPercentage: 25, packRoundingBase: 1000 },
      AREA,
    )!;
    // 10.000 × 4 = 40.000 · −25% = 30.000
    expect(precioPack(10_000, config, p)).toBe(30_000);
  });

  it("un pack sin descuento cuesta exactamente N veces el combo", () => {
    const p = politicaDeUnPack(
      { packSessions: 3, packDiscountPercentage: 0, packRoundingBase: 1 },
      AREA,
    )!;
    expect(precioPack(7_350, config, p)).toBe(22_050);
  });
});
