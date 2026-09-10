import { describe, expect, it } from "vitest";
import { vencimientoHeredado } from "./herencia-de-vencimiento";

const d = (iso: string) => new Date(iso);

const acredita = (fecha: string, monto: number, vence: string | null, compra?: string) => ({
  amount: monto,
  createdAt: d(fecha),
  expiresAt: vence ? d(vence) : null,
  customerPurchaseId: compra ?? null,
});
const pagaCon = (fecha: string, monto: number, compra: string) => ({
  amount: -monto,
  createdAt: d(fecha),
  expiresAt: null,
  customerPurchaseId: compra,
});

describe("vencimientoHeredado", () => {
  it("la plata vuelve con la fecha que tenía, no con tres meses nuevos", () => {
    // El caso de Sofía: $80.000 vencidos el 09/07 que pagaron un pack.
    const r = vencimientoHeredado(
      [
        acredita("2026-04-09T18:03:00Z", 80000, "2026-07-09T18:03:00Z"),
        pagaCon("2026-09-10T13:37:00Z", 76000, "lifting-1"),
      ],
      "lifting-1",
    );
    expect(r).toEqual(d("2026-07-09T18:03:00Z"));
  });

  it("si la compra no se pagó con saldo, no hereda nada", () => {
    // Pagada en efectivo: la cancelación le da el plazo normal.
    const r = vencimientoHeredado(
      [acredita("2026-04-09T18:03:00Z", 80000, "2026-07-09T18:03:00Z")],
      "otra-compra",
    );
    expect(r).toBeNull();
  });

  it("si el saldo que la pagó no vencía, tampoco hereda", () => {
    const r = vencimientoHeredado(
      [
        acredita("2026-04-09T18:03:00Z", 80000, null),
        pagaCon("2026-09-10T13:37:00Z", 76000, "lifting-1"),
      ],
      "lifting-1",
    );
    expect(r).toBeNull();
  });

  it("si el pago se comió dos lotes, hereda el vencimiento más viejo", () => {
    // Quedarse con el más lejano le estiraría el plazo a la mitad de esa plata.
    const r = vencimientoHeredado(
      [
        acredita("2026-04-01T10:00:00Z", 30000, "2026-07-01T10:00:00Z"),
        acredita("2026-06-01T10:00:00Z", 50000, "2026-09-01T10:00:00Z"),
        pagaCon("2026-09-10T13:37:00Z", 60000, "lifting-1"),
      ],
      "lifting-1",
    );
    expect(r).toEqual(d("2026-07-01T10:00:00Z"));
  });

  it("no mira los lotes que el pago NO alcanzó a tocar", () => {
    // El pago de 20.000 sale entero del primer lote; el segundo ni se roza, así
    // que su fecha no tiene por qué contaminar la herencia.
    const r = vencimientoHeredado(
      [
        acredita("2026-06-01T10:00:00Z", 50000, "2026-09-01T10:00:00Z"),
        acredita("2026-07-01T10:00:00Z", 50000, "2026-10-01T10:00:00Z"),
        pagaCon("2026-09-10T13:37:00Z", 20000, "lifting-1"),
      ],
      "lifting-1",
    );
    expect(r).toEqual(d("2026-09-01T10:00:00Z"));
  });

  it("los consumos anteriores ya vaciaron su lote: se hereda del siguiente", () => {
    const r = vencimientoHeredado(
      [
        acredita("2026-04-01T10:00:00Z", 30000, "2026-07-01T10:00:00Z"),
        acredita("2026-06-01T10:00:00Z", 50000, "2026-09-01T10:00:00Z"),
        pagaCon("2026-08-01T10:00:00Z", 30000, "compra-vieja"),
        pagaCon("2026-09-10T13:37:00Z", 40000, "lifting-1"),
      ],
      "lifting-1",
    );
    expect(r).toEqual(d("2026-09-01T10:00:00Z"));
  });

  it("sin movimientos no rompe", () => {
    expect(vencimientoHeredado([], "lifting-1")).toBeNull();
  });
});
