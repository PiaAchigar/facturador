/**
 * Cotizar una venta: qué se está por vender, por cuánto y hasta cuándo vale.
 *
 * Esto corre EN EL SERVIDOR y no en el navegador, a diferencia de lo que
 * sugería el spec. El motivo es el catálogo: para saber cuánto sale un combo
 * de depilación hay que armar sus zonas, leer la política global y correr la
 * fórmula (`assembleDepilationCombo`), y un combo genérico tiene su precio
 * congelado línea por línea. Espejar todo eso en front-crm sería una segunda
 * copia del catálogo que se desincroniza sola.
 *
 * Lo que sí se mantiene del diseño: la venta **congela** los tres montos. Esta
 * función los calcula una vez, la pantalla los muestra, y lo que se guarda es
 * lo que Laura vio — no una fórmula que mañana daría otro número.
 *
 * Lógica pura, sin base de datos.
 */

import {
  aplicarPromo,
  precioDeCompra,
  type PackPolitica,
  type PrecioDeCompra,
} from "./pack-pricing";

/**
 * Algo que se puede vender, ya normalizado por el repositorio.
 *
 * Los tres orígenes de `customer_purchase` caen en dos comportamientos:
 *
 * - **`combo`** trae el precio ya calculado por el catálogo (`servicesSubtotal`
 *   y `finalAmount` de `assembleCombo`). No se recalcula acá: sería una segunda
 *   verdad sobre el mismo número, y la que se vería en el dashboard es la otra.
 * - **`depilacion`** y **`servicio`** traen el precio de UNA sesión y la
 *   política del pack. El descuento se calcula.
 */
export type ItemVendible =
  | {
      origen: "combo";
      id: string;
      nombre: string;
      /** Suma de las líneas, sin el descuento del combo. */
      base: number;
      /** Lo que el combo cuesta según el catálogo. */
      conDescuento: number;
      /** Meses de vigencia. NULL = no vence. */
      validityMonths: number | null;
    }
  | {
      origen: "depilacion" | "servicio";
      id: string;
      nombre: string;
      /** Lo que sale UNA sesión, sin ningún descuento. */
      unitario: number;
      politica: PackPolitica;
    };

export type PromoVendible = {
  id: string;
  name: string | null;
  discountPercentage: number | null;
  discountAmount: number | null;
};

export type Cotizacion = PrecioDeCompra & {
  description: string;
  sessionsTotal: number;
  promotionId: string | null;
  expiresAt: Date | null;
};

/** `purchasedAt + n meses`. Usa UTC igual que el resto de las fechas del worker. */
function sumarMeses(desde: Date, meses: number): Date {
  const d = new Date(desde);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d;
}

/**
 * Cuántas sesiones lleva el pack de este item, o `null` si no es un pack.
 * Sirve para que la pantalla ofrezca el número correcto sin adivinar.
 */
export function sesionesDelPack(item: ItemVendible): number | null {
  return item.origen === "combo" ? null : item.politica.sesiones;
}

/**
 * La cotización completa.
 *
 * **La regla del descuento, en una línea:** la fórmula del pack corre sólo si
 * las sesiones que se venden son las del pack. Comprar 2 sesiones sueltas por
 * adelantado no es un pack de 6, y aplicarle el descuento del pack de 6 sería
 * regalar plata sin que nada avise.
 */
export function cotizar(
  item: ItemVendible,
  sesiones: number,
  promo: PromoVendible | null | undefined,
  compradoEl: Date,
): Cotizacion {
  if (!Number.isInteger(sesiones) || sesiones < 1) {
    throw new Error("La compra necesita al menos una sesión");
  }

  if (item.origen === "combo") {
    // El combo YA es el paquete: sus sesiones están adentro, en las líneas.
    // Venderlo "por 3" duplicaría el paquete sin decir de qué.
    if (sesiones !== 1) {
      throw new Error("Un combo se vende de a uno: las sesiones ya están en sus líneas");
    }
    if (item.conDescuento <= 0) {
      throw new Error(`"${item.nombre}" está sin precio en el catálogo: no se puede vender`);
    }
    return {
      description: item.nombre,
      sessionsTotal: 1,
      promotionId: promo?.id ?? null,
      expiresAt: item.validityMonths == null ? null : sumarMeses(compradoEl, item.validityMonths),
      baseAmount: item.base,
      discountedAmount: item.conDescuento,
      finalAmount: aplicarPromo(item.conDescuento, promo),
    };
  }

  if (item.unitario <= 0) {
    throw new Error(`"${item.nombre}" está sin precio cargado: no se puede vender`);
  }

  const esPack = sesiones === item.politica.sesiones;
  const precios = precioDeCompra(
    item.unitario,
    sesiones,
    esPack
      ? { forma: "formula", config: politicaComoConfig(item.politica), propia: item.politica }
      : { forma: "fijo", precioFijo: item.unitario },
    promo,
  );

  return {
    ...precios,
    description: describir(item.nombre, sesiones, esPack),
    sessionsTotal: sesiones,
    promotionId: promo?.id ?? null,
    // Ni depilación ni los servicios tienen vencimiento cargado hoy (§9 del
    // spec). Va NULL, que es "no vence", y no una fecha inventada.
    expiresAt: null,
  };
}

/** `precioDeCompra` pide la config global como respaldo; acá la política ya
 *  está resuelta, así que se pasa a sí misma y el respaldo nunca se usa. */
function politicaComoConfig(p: PackPolitica) {
  return { packSesiones: p.sesiones, packDescuentoPct: p.descuentoPct, packRedondeo: p.redondeo };
}

/** "Media pierna — pack de 6" / "Venus Legacy — 2 sesiones" / "Venus Legacy". */
function describir(nombre: string, sesiones: number, esPack: boolean): string {
  if (esPack) return `${nombre} — pack de ${sesiones}`;
  if (sesiones > 1) return `${nombre} — ${sesiones} sesiones`;
  return nombre;
}
