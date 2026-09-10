/**
 * Avisar cuando el combo o el pack que se está por crear ya existe.
 *
 * Pedido de Pia (2026-09-11): *"si va a armar un combo que ya existe, que el
 * sistema le avise para que no se dupliquen"*. Dos combos con los mismos
 * servicios y precios distintos son un problema de mostrador — la vendedora no
 * tiene forma de saber cuál cobrar.
 *
 * **Es un aviso, no un candado.** La función dice qué encontró; decidir si
 * igual se crea es de quien está cargando. Bloquear obligaría a adivinar los
 * casos legítimos que todavía no aparecieron.
 *
 * Lógica pura, sin base de datos.
 */

export type ComboComparable = {
  id: string;
  name: string;
  /** El área es parte de la identidad: el mismo combo en dos áreas son dos
   *  productos distintos, y así lo pidió Pia al separar las solapas. */
  areaCategoryId: string;
  kind: "combo" | "pack";
  /** Sólo en un pack que repite un combo. */
  packOfComboId: string | null;
  /** Sólo en un pack: cuántas veces repite. */
  packSessions: number | null;
  /** Los servicios que lo forman. En un pack de un combo va vacío. */
  serviceIds: string[];
};

/**
 * La identidad del producto, como texto comparable.
 *
 * Lo que NO entra, y es a propósito:
 *
 * - **El precio.** Es justamente lo que suele diferir entre los duplicados que
 *   queremos cazar.
 * - **El nombre.** "Facial Completo" y "Combo Facial" con los mismos tres
 *   servicios son el mismo producto escrito distinto, y ese es el caso que más
 *   se repite.
 * - **`services_together`.** Un combo junto y uno separado con los mismos
 *   servicios se parecen demasiado como para no avisar; si de verdad son dos
 *   productos, quien carga sigue de largo.
 *
 * Los ids se ordenan antes de unirlos: el mismo combo cargado en otro orden
 * tiene que dar la misma huella.
 */
export function huellaDeCombo(c: ComboComparable): string {
  const area = `${c.kind}|${c.areaCategoryId}`;
  const servicios = [...c.serviceIds].sort().join(",");

  if (c.kind === "combo") return `${area}|${servicios}`;

  // Un pack se identifica por QUÉ repite y CUÁNTAS veces. Repetir el mismo
  // combo 3 y 5 veces son dos packs legítimos, no un duplicado.
  const que = c.packOfComboId ? `c:${c.packOfComboId}` : `s:${servicios}`;
  return `${area}|${que}|${c.packSessions ?? 0}`;
}

/**
 * Los que ya existen con la misma identidad.
 *
 * `candidato.id` se excluye para que editar el precio de un combo guardado no
 * se avise a sí mismo como duplicado.
 */
export function combosDuplicados(
  candidato: ComboComparable,
  existentes: readonly ComboComparable[],
): ComboComparable[] {
  const huella = huellaDeCombo(candidato);
  return existentes.filter((e) => e.id !== candidato.id && huellaDeCombo(e) === huella);
}
