import { describe, expect, it } from "vitest";
import { MESES_DE_VIGENCIA, lotesDeSaldo, vencimientoPara } from "./vencimiento-de-saldo";

const AHORA = new Date("2026-09-09T12:00:00Z");
const d = (iso: string) => new Date(iso);

/** Una acreditación con su plazo. */
function acredita(fecha: string, monto: number, vence: string | null) {
  return { amount: monto, createdAt: d(fecha), expiresAt: vence ? d(vence) : null };
}
/** Un consumo (siempre negativo). */
function gasta(fecha: string, monto: number) {
  return { amount: -monto, createdAt: d(fecha), expiresAt: null };
}

describe("vencimientoPara", () => {
  it("son 3 meses desde la acreditación", () => {
    expect(MESES_DE_VIGENCIA).toBe(3);
    expect(vencimientoPara(d("2026-09-09T12:00:00Z"))).toEqual(d("2026-12-09T12:00:00Z"));
  });

  it("cruza el año sin romperse", () => {
    expect(vencimientoPara(d("2026-11-30T12:00:00Z"))).toEqual(d("2027-02-28T12:00:00Z"));
  });
});

describe("lotesDeSaldo", () => {
  it("sin movimientos, no hay nada", () => {
    expect(lotesDeSaldo([], AHORA)).toMatchObject({ vigente: 0, vencido: 0 });
  });

  it("una acreditación vigente está entera disponible", () => {
    const r = lotesDeSaldo([acredita("2026-08-01T10:00:00Z", 110667, "2026-11-01T10:00:00Z")], AHORA);
    expect(r).toMatchObject({ vigente: 110667, vencido: 0 });
  });

  it("una acreditación pasada de fecha está vencida", () => {
    const r = lotesDeSaldo([acredita("2026-05-01T10:00:00Z", 110667, "2026-08-01T10:00:00Z")], AHORA);
    expect(r).toMatchObject({ vigente: 0, vencido: 110667 });
  });

  it("lo que se gastó no vence: ya se usó", () => {
    const r = lotesDeSaldo(
      [acredita("2026-05-01T10:00:00Z", 110667, "2026-08-01T10:00:00Z"), gasta("2026-06-01T10:00:00Z", 110667)],
      AHORA,
    );
    expect(r).toMatchObject({ vigente: 0, vencido: 0 });
  });

  it("gasta lo MÁS VIEJO primero", () => {
    // Tiene $100.000 de mayo (vencido) y $50.000 de agosto (vigente), y gastó
    // $100.000 en junio. Si el gasto saliera del lote nuevo, hoy le vencerían
    // los $50.000 de agosto y perdería plata que en realidad ya usó.
    const r = lotesDeSaldo(
      [
        acredita("2026-05-01T10:00:00Z", 100000, "2026-08-01T10:00:00Z"),
        acredita("2026-08-01T10:00:00Z", 50000, "2026-11-01T10:00:00Z"),
        gasta("2026-06-01T10:00:00Z", 100000),
      ],
      AHORA,
    );
    expect(r).toMatchObject({ vigente: 50000, vencido: 0 });
  });

  it("un gasto parcial deja vencer sólo el resto del lote viejo", () => {
    const r = lotesDeSaldo(
      [acredita("2026-05-01T10:00:00Z", 100000, "2026-08-01T10:00:00Z"), gasta("2026-06-01T10:00:00Z", 40000)],
      AHORA,
    );
    expect(r).toMatchObject({ vigente: 0, vencido: 60000 });
  });

  it("un gasto se puede repartir entre dos lotes", () => {
    // El gasto va DESPUÉS de las dos acreditaciones: se lleva los $100.000 de
    // mayo enteros y $20.000 del lote de agosto.
    const r = lotesDeSaldo(
      [
        acredita("2026-05-01T10:00:00Z", 100000, "2026-08-01T10:00:00Z"),
        acredita("2026-08-01T10:00:00Z", 50000, "2026-11-01T10:00:00Z"),
        gasta("2026-08-15T10:00:00Z", 120000),
      ],
      AHORA,
    );
    expect(r).toMatchObject({ vigente: 30000, vencido: 0 });
  });

  it("no se puede gastar plata que todavía no se acreditó", () => {
    // El gasto de junio sólo alcanza el lote de mayo; lo de agosto todavía no
    // existía. Cronológicamente no hay de dónde sacar los $20.000 que faltan.
    const r = lotesDeSaldo(
      [
        acredita("2026-05-01T10:00:00Z", 100000, "2026-08-01T10:00:00Z"),
        acredita("2026-08-01T10:00:00Z", 50000, "2026-11-01T10:00:00Z"),
        gasta("2026-06-01T10:00:00Z", 120000),
      ],
      AHORA,
    );
    expect(r).toMatchObject({ vigente: 50000, vencido: 0 });
  });

  it("un saldo sin plazo no vence nunca", () => {
    // Los movimientos anteriores a la 1.47.0 se acreditaron sin vencimiento y
    // así se les prometió.
    const r = lotesDeSaldo([acredita("2020-01-01T10:00:00Z", 50000, null)], AHORA);
    expect(r).toMatchObject({ vigente: 50000, vencido: 0 });
  });

  it("el que vence hoy más tarde todavía no venció", () => {
    const r = lotesDeSaldo([acredita("2026-06-09T18:00:00Z", 1000, "2026-09-09T18:00:00Z")], AHORA);
    expect(r.vencido).toBe(0);
  });

  it("devuelve los lotes vencidos con su origen, para el cartel", () => {
    const r = lotesDeSaldo(
      [{ ...acredita("2026-05-01T10:00:00Z", 100000, "2026-08-01T10:00:00Z"), notes: 'Cancelación de "Cuerpo Full"' }],
      AHORA,
    );
    expect(r.lotesVencidos).toHaveLength(1);
    expect(r.lotesVencidos[0]).toMatchObject({ restante: 100000, notes: 'Cancelación de "Cuerpo Full"' });
  });

  it("no cuenta dos veces un vencimiento ya cobrado", () => {
    // Al pasarlo a caja se escribe un movimiento negativo. La próxima corrida
    // tiene que ver cero, o Laura lo cobraría todos los días.
    const r = lotesDeSaldo(
      [acredita("2026-05-01T10:00:00Z", 100000, "2026-08-01T10:00:00Z"), gasta("2026-09-09T11:00:00Z", 100000)],
      AHORA,
    );
    expect(r).toMatchObject({ vigente: 0, vencido: 0 });
  });

  it("el orden de entrada no importa: ordena por fecha", () => {
    const r = lotesDeSaldo(
      [
        gasta("2026-06-01T10:00:00Z", 100000),
        acredita("2026-08-01T10:00:00Z", 50000, "2026-11-01T10:00:00Z"),
        acredita("2026-05-01T10:00:00Z", 100000, "2026-08-01T10:00:00Z"),
      ],
      AHORA,
    );
    expect(r).toMatchObject({ vigente: 50000, vencido: 0 });
  });

  it("gastar más de lo acreditado no deja lotes en negativo", () => {
    // No debería pasar (el débito exige saldo), pero si pasara, un restante
    // negativo se sumaría al vigente y lo bajaría de menos.
    const r = lotesDeSaldo(
      [acredita("2026-08-01T10:00:00Z", 50000, "2026-11-01T10:00:00Z"), gasta("2026-08-02T10:00:00Z", 80000)],
      AHORA,
    );
    expect(r.vigente).toBe(0);
  });
});

