-- 1.49.0 — La nota de crédito como comprobante propio
--
-- Devolverle la plata a una clienta cuya compra estaba facturada exige una
-- NOTA DE CRÉDITO en ARCA. Hasta ahora la única forma de emitir una era
-- "Anular comprobante", que anula la factura ENTERA — y una devolución puede
-- ser parcial: de un pack de 3 por $166.000 con una sesión ya usada se
-- devuelven $110.667 y los $55.333 consumidos siguen facturados.
--
-- POR QUÉ ES UNA FILA DE `invoices` Y NO UNA TABLA NUEVA
-- Porque en ARCA una nota de crédito ES un comprobante: tiene su propio tipo
-- (C = 13, contra 11 de la factura) y su propia numeración. El cliente ARCA ya
-- lo sabe (CREDIT_NOTE_CODES en afip-client.ts). Modelarla aparte obligaría a
-- duplicar numeración, emisión, logs de ARCA y la pantalla entera.
--
-- `credit_note_of` es todo lo que hace falta: si está, esa fila es una nota de
-- crédito de la factura que apunta. NULL = factura común, que es lo que son
-- todas las que ya existen.
--
-- Nace en `draft` como cualquier comprobante y Laura la emite cuando quiere,
-- desde la misma lista de Facturas donde ya trabaja sus borradores.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'credit_note_of'
  ) THEN
    ALTER TABLE invoices ADD COLUMN credit_note_of uuid;

    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_credit_note_of
      FOREIGN KEY (credit_note_of) REFERENCES invoices (id);

    COMMENT ON COLUMN invoices.credit_note_of IS
      'Si no es NULL, esta fila es una NOTA DE CRÉDITO de la factura apuntada. '
      'El monto puede ser menor al de la original (devolución parcial). '
      'NULL = factura común.';

    -- Parcial: las notas de crédito son pocas frente a las facturas, y la
    -- consulta que importa es "¿esta factura tiene notas de crédito?".
    CREATE INDEX idx_invoices_credit_note_of
      ON invoices (credit_note_of)
      WHERE credit_note_of IS NOT NULL;

    RAISE NOTICE 'invoices.credit_note_of agregada.';
  ELSE
    RAISE NOTICE 'invoices.credit_note_of ya existía, no se toca.';
  END IF;
END $$;

-- Verificación (correr aparte):
-- SELECT count(*) FILTER (WHERE credit_note_of IS NOT NULL) AS notas_de_credito,
--        count(*) FILTER (WHERE credit_note_of IS NULL)     AS facturas
--   FROM invoices;
