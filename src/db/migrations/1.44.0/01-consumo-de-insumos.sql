-- ════════════════════════════════════════════════════════════════════════════
-- 1.44.0 / 01 — Consumo de insumos al completar un turno
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA. El SQL Editor de Supabase hace autocommit por sentencia:
-- si esto fueran varias, un error en el medio dejaría la base a medio armar
-- (pasó de verdad con la 1.34.0). Por eso va todo en un único bloque DO, sin
-- `CREATE TEMP TABLE ... ON COMMIT DROP` y sin `\echo`.
--
-- DOS COSAS
--
-- 1. `products.quantity_in_stock` pasa de integer a numeric(10,3).
--
--    La 1.43.0 dejó `service_product.quantity` en numeric(10,3) porque media
--    ampolla es media ampolla. Pero el stock era ENTERO: descontar 0.5 de un
--    integer redondea, y el stock se iría desviando un poquito en cada
--    servicio hasta no querer decir nada. Las dos columnas tienen que hablar
--    en la misma unidad.
--
--    El cambio es lossless: todo integer entra en numeric(10,3).
--
-- 2. `appointment_product_consumption` — qué consumió cada turno.
--
--    Sin esto, completar dos veces el mismo turno descuenta dos veces. El
--    servicio ya sólo descuenta en la TRANSICIÓN a 'completed', pero dos
--    requests simultáneas pueden leer las dos que el turno todavía no estaba
--    completado y descontar las dos. El UNIQUE (appointment_id, product_id) lo
--    hace imposible a nivel base, que es donde tiene que ser imposible.
--
--    Además es el registro de qué se gastó de verdad: `service_product` dice
--    lo que un servicio DEBERÍA consumir hoy, y cambia cuando se edita la
--    receta. Esta tabla dice lo que ese turno consumió, y no cambia nunca.
--
-- No se revierte al descompletar porque no se puede descompletar: un turno en
-- 'completed' no cambia de estado (appointments.service.ts).
--
-- Idempotente: el ALTER se saltea si ya es numeric, y CREATE TABLE IF NOT EXISTS.

DO $$
BEGIN
  -- ── 1. El stock admite fracciones ─────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'products' AND column_name = 'quantity_in_stock'
       AND data_type = 'integer'
  ) THEN
    ALTER TABLE products ALTER COLUMN quantity_in_stock TYPE numeric(10,3);
    RAISE NOTICE 'products.quantity_in_stock ahora es numeric(10,3)';
  ELSE
    RAISE NOTICE 'products.quantity_in_stock ya era numeric — nada que hacer';
  END IF;

  -- ── 2. Lo que consumió cada turno ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS appointment_product_consumption (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    product_id     uuid NOT NULL REFERENCES products(id)     ON DELETE CASCADE,
    quantity       numeric(10,3) NOT NULL,
    -- El stock que quedó después de descontar. Es lo que permite reconstruir
    -- qué pasó sin depender del valor actual, que ya cambió mil veces.
    stock_after    numeric(10,3),
    created_at     timestamp NOT NULL DEFAULT now(),
    -- La red contra el doble descuento. Va acá y no sólo en la app porque dos
    -- requests simultáneas ganan cualquier chequeo hecho en memoria.
    CONSTRAINT ux_appt_product_consumption UNIQUE (appointment_id, product_id)
  );

  CREATE INDEX IF NOT EXISTS ix_appt_consumption_product
    ON appointment_product_consumption (product_id, created_at DESC);

  RAISE NOTICE 'appointment_product_consumption lista';
END $$;

-- ── Verificación (correr aparte, no forma parte de la migración) ────────────
-- SELECT column_name, data_type, numeric_precision, numeric_scale
--   FROM information_schema.columns
--  WHERE table_name = 'products' AND column_name = 'quantity_in_stock';
--
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'appointment_product_consumption' ORDER BY ordinal_position;
