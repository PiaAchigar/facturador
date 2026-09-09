import { describe, expect, it } from "vitest";
import { planDePagoConSaldo } from "./pago-con-saldo";

describe("planDePagoConSaldo", () => {
  it("con saldo de sobra, la compra queda paga y sobra plata", () => {
    const p = planDePagoConSaldo({ aPagar: 51000, saldoDisponible: 110667 });
    expect(p).toMatchObject({ conSaldo: 51000, restaPagar: 0, saldoDespues: 59667 });
  });

  it("con saldo justo, queda todo en cero", () => {
    const p = planDePagoConSaldo({ aPagar: 110667, saldoDisponible: 110667 });
    expect(p).toMatchObject({ conSaldo: 110667, restaPagar: 0, saldoDespues: 0 });
  });

  it("si no alcanza, usa todo el saldo y el resto queda por cobrar", () => {
    // No se rechaza la venta: se usa lo que hay y Laura cobra la diferencia.
    const p = planDePagoConSaldo({ aPagar: 166000, saldoDisponible: 110667 });
    expect(p).toMatchObject({ conSaldo: 110667, restaPagar: 55333, saldoDespues: 0 });
  });

  it("sin saldo, no toca nada", () => {
    const p = planDePagoConSaldo({ aPagar: 166000, saldoDisponible: 0 });
    expect(p).toMatchObject({ conSaldo: 0, restaPagar: 166000, saldoDespues: 0 });
  });

  it("se puede usar menos saldo del que hay", () => {
    // Laura puede querer guardarle saldo para otra cosa, o cobrar en efectivo
    // parte de la venta.
    const p = planDePagoConSaldo({ aPagar: 166000, saldoDisponible: 110667, usar: 50000 });
    expect(p).toMatchObject({ conSaldo: 50000, restaPagar: 116000, saldoDespues: 60667 });
  });

  it("no se puede usar más saldo del que hay", () => {
    const p = planDePagoConSaldo({ aPagar: 166000, saldoDisponible: 50000, usar: 999999 });
    expect(p).toMatchObject({ conSaldo: 50000, restaPagar: 116000, saldoDespues: 0 });
  });

  it("no se puede usar más saldo que el precio de la compra", () => {
    // Aplicar $110.667 a una compra de $51.000 dejaría un pago de más que
    // después habría que devolver. El sobrante se queda como saldo.
    const p = planDePagoConSaldo({ aPagar: 51000, saldoDisponible: 110667, usar: 110667 });
    expect(p).toMatchObject({ conSaldo: 51000, saldoDespues: 59667 });
  });

  it("un `usar` negativo no acredita plata", () => {
    const p = planDePagoConSaldo({ aPagar: 51000, saldoDisponible: 110667, usar: -5000 });
    expect(p.conSaldo).toBe(0);
  });

  it("una compra de cero no consume saldo", () => {
    const p = planDePagoConSaldo({ aPagar: 0, saldoDisponible: 110667 });
    expect(p).toMatchObject({ conSaldo: 0, restaPagar: 0, saldoDespues: 110667 });
  });

  it("dice si el saldo alcanzó para todo", () => {
    expect(planDePagoConSaldo({ aPagar: 51000, saldoDisponible: 110667 }).cubreTodo).toBe(true);
    expect(planDePagoConSaldo({ aPagar: 166000, saldoDisponible: 110667 }).cubreTodo).toBe(false);
  });
});
