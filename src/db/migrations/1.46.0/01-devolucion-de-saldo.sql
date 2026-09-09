-- 1.46.0 — Devolver el saldo a favor en efectivo
--
-- Un solo bloque DO: el SQL Editor de Supabase hace autocommit por sentencia,
-- así que varias sentencias dejarían la migración a medio aplicar si una falla.
--
-- Qué agrega: de qué COMPRA salió cada movimiento de saldo a favor.
--
-- Sin esto no se puede responder "¿esta plata a favor vino de un pack pagado
-- entero o de una seña?", que es justo lo que decide si se puede devolver en
-- efectivo (regla de Laura: sólo se devuelve lo que se pagó al 100%). Y es
-- también lo que evita devolver dos veces la misma compra.
--
-- La columna es NULLABLE a propósito: los movimientos que ya existen vienen de
-- señas de turnos (`appointment_id`) y no tienen compra. Ponerla NOT NULL
-- obligaría a inventarles una.

DO $$
BEGIN
  ALTER TABLE customer_credit_movements
    ADD COLUMN IF NOT EXISTS customer_purchase_id uuid;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_ccm_purchase'
  ) THEN
    ALTER TABLE customer_credit_movements
      ADD CONSTRAINT fk_ccm_purchase
      FOREIGN KEY (customer_purchase_id) REFERENCES customer_purchase(id);
  END IF;

  -- Se consulta por compra para saber si ya se devolvió. Sin índice eso es un
  -- scan de toda la tabla en cada apertura del cartel.
  CREATE INDEX IF NOT EXISTS ix_ccm_purchase
    ON customer_credit_movements (customer_purchase_id);

  RAISE NOTICE '1.46.0 aplicada: customer_credit_movements.customer_purchase_id';
END $$;

-- Verificación (correr aparte):
-- SELECT column_name, is_nullable FROM information_schema.columns
--  WHERE table_name = 'customer_credit_movements' AND column_name = 'customer_purchase_id';
