/**
 * Contra qué compra se descuenta el turno que se está por agendar.
 *
 * Regla de Pia (2026-09-10), en `reglas_negocio.md` §3.8:
 *
 * - **Una sola opción → se descuenta sola.** Hacerla elegir cuando no hay nada
 *   que elegir es un click de más en el mostrador.
 * - **Más de una → elige Laura.** Adivinar gastaría el pack equivocado, y
 *   deshacer eso es un lío: hay que reagendar y devolver la sesión a mano.
 *
 * **Se elige la COMPRA, no la sesión.** Las sesiones de un mismo pack son
 * intercambiables —la 2 y la 3 de "Limpieza × 4" valen lo mismo—, así que
 * ofrecerlas por separado sería pedirle a Laura una decisión que no existe.
 * Adentro de la compra sale la de número más bajo, que deja el pack
 * consumiéndose en orden.
 *
 * Lógica pura, sin base de datos.
 */

export type SesionDisponible = {
  sessionId: string;
  purchaseId: string;
  /** Lo que se le muestra a Laura: la descripción congelada de la compra. */
  descripcion: string;
  /** Su lugar en el pack. Se consume de menor a mayor. */
  sessionNumber: number;
  /** Cuándo vence la compra. NULL = no vence. */
  venceEl: Date | null;
};

/** Una compra con sesiones libres, como se le ofrece a Laura. */
export type OpcionDeCompra = {
  purchaseId: string;
  descripcion: string;
  /** Cuántas sesiones libres quedan en esta compra. */
  disponibles: number;
  venceEl: Date | null;
  /** La que se descontaría si eligen esta compra. */
  sessionId: string;
};

/**
 * Agrupa las sesiones libres por compra y las ordena por urgencia.
 *
 * Primero lo que vence antes: si Laura tiene que elegir, lo que está por
 * perderse va arriba. Lo que no vence va último — no corre riesgo. A igual
 * vencimiento, por descripción, para que la lista no baile entre pantallas.
 */
export function opcionesDeCompra(sesiones: readonly SesionDisponible[]): OpcionDeCompra[] {
  const porCompra = new Map<string, SesionDisponible[]>();
  for (const s of sesiones) {
    const lista = porCompra.get(s.purchaseId) ?? [];
    lista.push(s);
    porCompra.set(s.purchaseId, lista);
  }

  const opciones: OpcionDeCompra[] = [];
  for (const [purchaseId, lista] of porCompra) {
    const enOrden = [...lista].sort((a, b) => a.sessionNumber - b.sessionNumber);
    const primera = enOrden[0]!;
    opciones.push({
      purchaseId,
      descripcion: primera.descripcion,
      disponibles: enOrden.length,
      venceEl: primera.venceEl,
      sessionId: primera.sessionId,
    });
  }

  return opciones.sort((a, b) => {
    if (a.venceEl && b.venceEl) {
      const dif = a.venceEl.getTime() - b.venceEl.getTime();
      if (dif !== 0) return dif;
    } else if (a.venceEl !== b.venceEl) {
      // El que vence va antes que el que no vence nunca.
      return a.venceEl ? -1 : 1;
    }
    return a.descripcion.localeCompare(b.descripcion, "es");
  });
}

export type Eleccion =
  | { tipo: "ninguna" }
  | { tipo: "automatica"; sessionId: string; opcion: OpcionDeCompra }
  | { tipo: "elige_laura"; opciones: OpcionDeCompra[] };

/**
 * Qué hacer con lo que la clienta tiene a favor para este servicio.
 *
 * `ninguna` no es un error: la mayoría de los turnos se cobran en el momento y
 * no descuentan nada. Quien llame sigue de largo.
 */
export function elegirSesion(sesiones: readonly SesionDisponible[]): Eleccion {
  const opciones = opcionesDeCompra(sesiones);
  if (opciones.length === 0) return { tipo: "ninguna" };
  if (opciones.length === 1) {
    const unica = opciones[0]!;
    return { tipo: "automatica", sessionId: unica.sessionId, opcion: unica };
  }
  return { tipo: "elige_laura", opciones };
}
