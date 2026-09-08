/**
 * Qué impide borrar o archivar una categoría.
 *
 * Lógica pura para poder testearla sin base de datos. La usa
 * `categories.repo.ts`; las rutas la consultan antes de tocar nada.
 */

type Categoria = { kind: string | null; isActive?: boolean | null };

/**
 * Las categorías de eje `area` son las pestañas del panel de Administración.
 * `admin-nav.ts` las referencia POR NOMBRE, así que borrar una deja su pestaña
 * vacía sin ningún error visible.
 *
 * Pasó de verdad el 2026-09-08: se eliminaron desde la papelera "Medicina y
 * Dermatología" y "Masajes y Bienestar" —estaban archivadas y parecían restos
 * de un intento viejo— y el borrado en cascada se llevó 70 vínculos
 * servicio→área. Dos pestañas quedaron sin un solo servicio y nadie se enteró
 * hasta abrir el modal de Nuevo Servicio y no encontrar las áreas.
 */
const MOTIVO_AREA =
  "es un área del panel: su pestaña de Administración depende de ella y quedaría vacía";

function esArea(cat: Categoria): boolean {
  return cat.kind === "area";
}

/**
 * Devuelve los motivos por los que NO se puede eliminar definitivamente.
 * Vacío = se puede.
 *
 * Cuando es un área se devuelve ESE motivo solo: decir "archivala primero"
 * mandaría a archivarla y volver a intentar, y el segundo intento tampoco
 * podría. El motivo que se muestra tiene que ser el que no tiene salida.
 */
export function razonesParaNoBorrar(cat: Categoria, hijas: number): string[] {
  if (esArea(cat)) return [MOTIVO_AREA];

  const motivos: string[] = [];
  if (hijas > 0) {
    motivos.push(
      `tiene ${hijas} subcategoría(s) colgando (eliminalas o movelas a otra madre primero)`,
    );
  }
  if (cat.isActive) motivos.push("está activa (archivala primero)");
  return motivos;
}

/**
 * Motivos para no archivar. Sólo se evalúa al archivar: restaurar nunca se
 * bloquea, porque es la salida cuando algo quedó archivado por error.
 */
export function razonesParaNoArchivar(cat: Categoria, restaurando = false): string[] {
  if (restaurando) return [];
  return esArea(cat) ? [MOTIVO_AREA] : [];
}
