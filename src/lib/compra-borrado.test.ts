import { describe, expect, it } from "vitest";
import { razonesParaNoBorrarCompra, type ImpactoDeBorrado } from "./compra-borrado";

const limpia: ImpactoDeBorrado = {
  pagos: 0,
  montoPagado: 0,
  facturas: 0,
  sesionesAgendadas: 0,
  sesionesConsumidas: 0,
  movimientosDeSaldo: 0,
};

describe("razonesParaNoBorrarCompra", () => {
  it("una venta recién hecha se borra: no hay nada colgando", () => {
    expect(razonesParaNoBorrarCompra(limpia)).toEqual([]);
  });

  it("un pago la traba, y dice cuánto", () => {
    // Sin el monto, el cartel diría "tiene 1 pago" y Laura no sabría si son
    // $500 o $160.000 antes de decidir.
    expect(razonesParaNoBorrarCompra({ ...limpia, pagos: 1, montoPagado: 66000 })).toEqual([
      "ya tiene 1 pago cobrado por $66.000",
    ]);
  });

  it("varios pagos van en plural", () => {
    expect(razonesParaNoBorrarCompra({ ...limpia, pagos: 3, montoPagado: 100000 })).toEqual([
      "ya tiene 3 pagos cobrados por $100.000",
    ]);
  });

  it("una factura la traba: es un comprobante fiscal", () => {
    expect(razonesParaNoBorrarCompra({ ...limpia, facturas: 1 })).toEqual([
      "está facturada (1 factura la incluye)",
    ]);
  });

  it("una sesión agendada la traba: hay un turno tomado", () => {
    expect(razonesParaNoBorrarCompra({ ...limpia, sesionesAgendadas: 2 })).toEqual([
      "tiene 2 sesiones agendadas con turno",
    ]);
  });

  it("una sesión consumida la traba: el tratamiento se hizo", () => {
    expect(razonesParaNoBorrarCompra({ ...limpia, sesionesConsumidas: 1 })).toEqual([
      "tiene 1 sesión ya consumida",
    ]);
  });

  it("un movimiento de saldo a favor la traba", () => {
    // La cancelación le acreditó plata: borrar la compra dejaría el libro de
    // saldo apuntando a algo que no existe.
    expect(razonesParaNoBorrarCompra({ ...limpia, movimientosDeSaldo: 1 })).toEqual([
      "movió el saldo a favor de la clienta",
    ]);
  });

  it("los junta todos: el cartel muestra la lista completa", () => {
    // Mostrar sólo el primero obliga a destrabar de a uno sin saber cuánto
    // falta.
    const motivos = razonesParaNoBorrarCompra({
      pagos: 1,
      montoPagado: 50000,
      facturas: 1,
      sesionesAgendadas: 1,
      sesionesConsumidas: 1,
      movimientosDeSaldo: 1,
    });
    expect(motivos).toHaveLength(5);
  });

  it("un pago de cero igual traba", () => {
    // Existe la fila del cobro aunque el monto sea raro. Borrar la compra
    // dejaría ese pago apuntando a algo que no está.
    expect(razonesParaNoBorrarCompra({ ...limpia, pagos: 1, montoPagado: 0 })).toHaveLength(1);
  });

  it("las sesiones sin usar NO traban", () => {
    // Son filas que nacieron con la compra y no representan nada que haya
    // pasado: se borran con ella.
    expect(razonesParaNoBorrarCompra(limpia)).toEqual([]);
  });
});
