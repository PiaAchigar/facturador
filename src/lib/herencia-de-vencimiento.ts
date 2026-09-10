/**
 * Qué vencimiento le corresponde a la plata que vuelve al cancelar una compra.
 *
 * **Cancelar nunca estira un plazo** (regla de Pia, 2026-09-10). Si la compra
 * se pagó con saldo a favor, la plata vuelve con la fecha que ya tenía.
 *
 * El agujero que tapa: Sofía tenía $80.000 VENCIDOS. Compró un pack con ese
 * saldo y lo canceló; la plata volvió con tres meses nuevos y dejó de estar
 * vencida. Comprando y arrepintiéndose, cualquiera limpiaba el vencimiento —
 * y encima sin querer, porque no hace falta mala intención para cancelar algo.
 *
 * Lógica pura, sin base de datos.
 */
import { type MovimientoDeSaldo, lotesDeSaldo } from "./vencimiento-de-saldo";

/**
 * La fecha más vieja entre los lotes que pagaron esta compra.
 *
 * `null` significa "no hereda nada" y el que llama le pone el plazo normal:
 * o la compra no se pagó con saldo, o el saldo que la pagó no vencía.
 *
 * Devuelve **la más vieja** de las fechas involucradas. Si el pago se comió dos
 * lotes con vencimientos distintos, quedarse con el más lejano sería estirarle
 * el plazo a la mitad de esa plata, que es justo lo que esto evita.
 */
export function vencimientoHeredado(
  movimientos: MovimientoDeSaldo[],
  compraId: string,
): Date | null {
  const enOrden = [...movimientos].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // El pago con saldo de ESTA compra. Sin él no hay nada que heredar.
  const i = enOrden.findIndex((m) => m.amount < 0 && m.customerPurchaseId === compraId);
  if (i === -1) return null;
  const pago = enOrden[i]!;

  // Cómo estaba la cuenta justo antes de ese pago. `lotesDeSaldo` reparte los
  // consumos anteriores, así que los lotes ya vienen con lo que les quedaba.
  const antes = lotesDeSaldo(enOrden.slice(0, i), pago.createdAt);
  const lotes = [...antes.lotesVencidos, ...antes.lotesVigentes].sort(
    (a, b) => a.acreditadoEl.getTime() - b.acreditadoEl.getTime(),
  );

  // Se consume del más viejo al más nuevo, igual que en el reparto real, y se
  // anota el vencimiento de cada lote que se haya tocado.
  let porPagar = -pago.amount;
  let heredado: Date | null = null;
  for (const lote of lotes) {
    if (porPagar <= 0) break;
    if (lote.restante <= 0) continue;
    porPagar -= Math.min(lote.restante, porPagar);
    if (lote.venceEl && (heredado == null || lote.venceEl < heredado)) {
      heredado = lote.venceEl;
    }
  }

  return heredado;
}
