-- ════════════════════════════════════════════════════════════════════════════
-- 1.48.0 — Vender capacitaciones
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA (bloque DO): el SQL Editor de Supabase hace autocommit por
-- sentencia y varias sentencias dejarían la migración a medio aplicar.
--
-- Las capacitaciones (`training`) tienen precio y sesiones desde la 1.0.0, pero
-- NO se podían vender: `training_enrollments` existe en el schema y ninguna
-- pantalla la escribe — sólo se lee para contar el impacto de borrar un
-- cliente. O sea que no hay un flujo de venta que esto duplique: es el primero.
--
-- Se suma como CUARTO origen de `customer_purchase`, que es exactamente lo que
-- el diseño de la 1.45.0 dejó previsto: "cuando llegue el motor de estética se
-- suma una cuarta columna y se actualiza el CHECK".
--
-- Las ACTIVIDADES quedan afuera a propósito: se venden como suscripción
-- mensual (`training_subscriptions.monthly_amount`), que es un cobro que se
-- repite, no una compra de N sesiones. Meterlas acá sería una segunda forma de
-- vender lo mismo.

DO $$
BEGIN
  ALTER TABLE customer_purchase ADD COLUMN IF NOT EXISTS training_id uuid;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cpu_training') THEN
    ALTER TABLE customer_purchase ADD CONSTRAINT fk_cpu_training
      FOREIGN KEY (training_id) REFERENCES training(id);
  END IF;

  -- El CHECK de origen único pasa de tres columnas a cuatro. Hay que soltarlo y
  -- rehacerlo: un CHECK no se puede "extender".
  ALTER TABLE customer_purchase DROP CONSTRAINT IF EXISTS ck_cpu_origen_unico;
  ALTER TABLE customer_purchase ADD CONSTRAINT ck_cpu_origen_unico CHECK (
    (combo_id IS NOT NULL)::int
    + (service_id IS NOT NULL)::int
    + (depilation_combo_id IS NOT NULL)::int
    + (training_id IS NOT NULL)::int = 1
  );

  RAISE NOTICE '1.48.0 aplicada: customer_purchase.training_id (cuarto origen)';
END $$;

-- Verificación (correr aparte):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_cpu_origen_unico';
