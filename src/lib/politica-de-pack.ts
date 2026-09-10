/**
 * Qué descuento le corre a un pack: el suyo, o el de su área.
 *
 * `politicaDePack()` de `pack-pricing.ts` trata al trío (sesiones, descuento,
 * redondeo) como un bloque: o va entero el del combo, o va entero el global.
 * Para un pack de catálogo eso no alcanza, porque las tres partes no vienen del
 * mismo lado:
 *
 *   sesiones   SIEMPRE del pack — es su identidad. "Facial × 4" es un pack de 4
 *              aunque el área tenga 3 por defecto.
 *   descuento  del pack si lo cargaron a mano; si no, del área.
 *   redondeo   ídem.
 *
 * Por eso esta función existe aparte en vez de meterle un caso especial a
 * `pack-pricing.ts`, que además está espejado byte a byte con front-dashboard.
 *
 * Lógica pura, sin base de datos.
 */

import type { PackPolitica } from "./pack-pricing";

/** El tarifario del área: la fila de `area_pack_policy`. */
export type PoliticaDeArea = {
  packDiscountPercentage: number;
  packRoundingBase: number;
};

/** Lo que el pack trae cargado. Los dos descuentos van de a dos o ninguno
 *  (lo garantiza `ck_combos_pack_precio`). */
export type PackGuardado = {
  packSessions: number | null;
  packDiscountPercentage: number | null;
  packRoundingBase: number | null;
};

/**
 * Arma la política efectiva del pack.
 *
 * Devuelve `null` si el pack no tiene sesiones: sin repetición no es un pack y
 * no hay precio de pack que calcular. La base lo impide con `ck_combos_pack`,
 * así que llegar acá con NULL significa que la fila es un combo, no un pack.
 */
export function politicaDeUnPack(
  pack: PackGuardado,
  area: PoliticaDeArea,
): PackPolitica | null {
  if (pack.packSessions == null) return null;
  return {
    sesiones: pack.packSessions,
    // `??` y no `||`: un descuento cargado en 0 —un pack sin rebaja, a propósito—
    // es un valor válido, y con `||` se caería al del área sin que nadie lo pida.
    descuentoPct: pack.packDiscountPercentage ?? area.packDiscountPercentage,
    redondeo: pack.packRoundingBase ?? area.packRoundingBase,
  };
}
