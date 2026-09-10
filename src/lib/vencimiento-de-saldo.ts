/**
 * Cuándo vence el saldo a favor y cuánto de él está vencido hoy.
 *
 * Regla de Laura (2026-09-09): la plata a favor se puede usar durante 3 meses.
 * Pasado ese plazo se pierde.
 *
 * **El problema que resuelve este archivo** no es la fecha —eso es una resta—
 * sino saber *qué* venció cuando la clienta gastó parte del saldo. El saldo es
 * un solo número, pero está hecho de acreditaciones con fechas distintas: si
 * tiene $100.000 de mayo y $50.000 de agosto y gastó $100.000, ¿qué le queda?
 *
 * **Se gasta lo más viejo primero.** Es lo que conviene a la clienta y lo que
 * evita vencerle plata que en realidad ya usó: con el criterio contrario, ese
 * gasto habría salido del lote de agosto y hoy se le vencerían $50.000 que no
 * tiene.
 *
 * Todo se DERIVA del libro de movimientos, sin ninguna columna de estado — el
 * mismo criterio que el estado de las sesiones. Un movimiento nuevo cambia el
 * resultado solo.
 *
 * Lógica pura, sin base de datos.
 */

/**
 * Meses de vigencia del saldo a favor.
 *
 * Constante y no configuración: Laura pidió poder cambiarlo desde
 * Configuraciones "a futuro" (2026-09-09), y hasta entonces el número vive acá.
 * Cuando exista esa pantalla, lo único que cambia es de dónde sale este valor
 * — las fechas ya acreditadas no se tocan, porque se guardan por movimiento.
 */
export const MESES_DE_VIGENCIA = 3;

/**
 * Hasta cuándo vale una acreditación hecha en esta fecha.
 *
 * Recorta al último día del mes destino en vez de dejar que se desborde: un
 * saldo del 30 de noviembre vence el 28 de febrero, no el 2 de marzo.
 * `setUTCMonth` solo hace lo segundo —"30 de febrero" se corre a marzo— y le
 * regala dos días a la clienta con cara de bug.
 */
export function vencimientoPara(acreditadoEl: Date): Date {
  const d = new Date(acreditadoEl);
  const diaOriginal = d.getUTCDate();
  // Al día 1 primero: así el cambio de mes nunca desborda solo.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + MESES_DE_VIGENCIA);
  const ultimoDelMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(diaOriginal, ultimoDelMes));
  return d;
}

export type MovimientoDeSaldo = {
  /** Id de la fila. Se arrastra hasta el lote porque aplazar necesita saber
   *  QUÉ acreditación mover, y adivinarla por fecha se rompe el día que dos
   *  caen en el mismo instante. */
  id?: string;
  /** Positivo acredita, negativo consume. */
  amount: number;
  createdAt: Date;
  /** Sólo en las acreditaciones. NULL = no vence. */
  expiresAt: Date | null;
  /** El texto que explica de dónde salió esa plata. Va al cartel. */
  notes?: string | null;
  /**
   * La compra a la que está atado este movimiento (1.46.0).
   *
   * En una acreditación dice qué cancelación la generó. En un consumo dice de
   * qué compra sale: una DEVOLUCIÓN nombra la misma compra que acreditó, y por
   * eso se puede devolver exactamente esa plata en vez de repartirla.
   */
  customerPurchaseId?: string | null;
};

export type LoteDeSaldo = {
  /** El movimiento que creó este lote. */
  id?: string;
  /** La compra cuya cancelación acreditó esta plata. */
  customerPurchaseId?: string | null;
  acreditadoEl: Date;
  venceEl: Date | null;
  original: number;
  restante: number;
  notes?: string | null;
};

export type EstadoDelSaldo = {
  /** Plata a favor que todavía se puede usar. */
  vigente: number;
  /** Plata a favor cuyo plazo pasó y nadie usó. */
  vencido: number;
  lotesVencidos: LoteDeSaldo[];
  lotesVigentes: LoteDeSaldo[];
};

/**
 * Reparte los consumos contra las acreditaciones, de la más vieja a la más
 * nueva, y dice qué quedó vigente y qué venció.
 *
 * Los consumos incluyen los vencimientos ya cobrados: al pasar un saldo
 * vencido a caja se escribe un movimiento negativo, y por eso la corrida
 * siguiente ve cero en vez de volver a cobrarlo.
 */
export function lotesDeSaldo(movimientos: MovimientoDeSaldo[], ahora: Date): EstadoDelSaldo {
  const enOrden = [...movimientos].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const lotes: LoteDeSaldo[] = [];
  for (const m of enOrden) {
    if (m.amount > 0) {
      lotes.push({
        id: m.id,
        customerPurchaseId: m.customerPurchaseId ?? null,
        acreditadoEl: m.createdAt,
        venceEl: m.expiresAt,
        original: m.amount,
        restante: m.amount,
        notes: m.notes,
      });
      continue;
    }

    let porDescontar = -m.amount;

    // Primero, el lote de SU MISMA compra si lo hay.
    //
    // Devolverle a la clienta la plata de "Cuerpo Full" tiene que vaciar el
    // lote que generó cancelar "Cuerpo Full", no el más viejo que ande dando
    // vueltas. Con el reparto por antigüedad la ficha mostraba consumida una
    // acreditación anterior y la devuelta intacta: la plata que ya no estaba
    // parecía disponible (bug encontrado por Pia, 2026-09-10).
    //
    // Un consumo cuyo id no corresponde a ningún lote —pagar una compra NUEVA
    // con saldo apunta a la compra que se paga, que nunca acreditó nada— no
    // matchea y cae en el reparto de abajo, que es lo correcto.
    if (m.customerPurchaseId) {
      for (const lote of lotes) {
        if (porDescontar <= 0) break;
        if (lote.customerPurchaseId !== m.customerPurchaseId) continue;
        const sale = Math.min(lote.restante, porDescontar);
        lote.restante -= sale;
        porDescontar -= sale;
      }
    }

    // El resto —o todo, si no venía atado a una compra— sale de lo más viejo.
    for (const lote of lotes) {
      if (porDescontar <= 0) break;
      const sale = Math.min(lote.restante, porDescontar);
      lote.restante -= sale;
      porDescontar -= sale;
    }
    // Si sobra `porDescontar` se descarta: significaría haber gastado más de lo
    // acreditado, que el débito no permite. Arrastrarlo dejaría lotes en
    // negativo que bajarían de menos el total vigente.
  }

  const vivos = lotes.filter((l) => l.restante > 0);
  const vencidos = vivos.filter((l) => l.venceEl != null && l.venceEl < ahora);
  const vigentes = vivos.filter((l) => l.venceEl == null || l.venceEl >= ahora);
  const sumar = (ls: LoteDeSaldo[]) => ls.reduce((a, l) => a + l.restante, 0);

  return {
    vigente: sumar(vigentes),
    vencido: sumar(vencidos),
    lotesVencidos: vencidos,
    lotesVigentes: vigentes,
  };
}
