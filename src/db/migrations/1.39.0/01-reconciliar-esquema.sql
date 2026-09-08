-- ════════════════════════════════════════════════════════════════════════════
-- 1.39.0 / 01 — Reconciliar el esquema local con producción
-- ════════════════════════════════════════════════════════════════════════════
-- Producción se fue de mano a mano: hay columnas que alguien cambió desde el
-- editor de Supabase y nunca quedaron escritas como migración. Comparando
-- `information_schema.columns` de las dos bases (2026-09-08) aparecieron seis
-- diferencias reales. Esta migración las escribe, para que una base creada
-- desde cero con `npm run db:reset` quede igual a producción.
--
-- **Es no-op en producción.** Cada paso está guardado por una condición que
-- allá ya se cumple, así que no ejecuta nada. Lo que arregla es LOCAL.
--
-- La primera es la que importa. `service.description` es `text` en producción
-- y era `varchar(255)` en local, y por eso la copia del catálogo real fallaba:
--   ERROR: value too long for type character varying(255)
-- Ese error se diagnosticó dos veces como si fuera un problema de la copia. No
-- lo era: era esta diferencia de esquema.
--
-- No se tocan las diferencias donde LOCAL es más ancha que producción
-- (`customers.cuit`, `service_providers.cuit` y `dni` son varchar(50) acá y
-- varchar(20) allá): más ancho nunca rompe una importación, y angostarlas
-- podría cortar datos.
--
-- Idempotente y de una sola sentencia, como pide el editor de Supabase.

DO $mig$
DECLARE
  v_vista text;
BEGIN

-- ── 1 · Las descripciones de servicio no entran en 255 caracteres ──
-- Las reales rondan los 150-300 y varias pasan los 600.
IF EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'service' AND column_name = 'description'
              AND data_type <> 'text') THEN
  ALTER TABLE service ALTER COLUMN description TYPE text;
  RAISE NOTICE 'service.description → text';
END IF;

-- ── 2 · Columnas que existen en producción y faltaban en local ──
ALTER TABLE service_embeddings ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE service_providers  ADD COLUMN IF NOT EXISTS user_id uuid;

-- ── 3 · Los `payment_type` son varchar sin límite en producción ──
-- En local eran varchar(50). Nunca falló porque los valores son cortos
-- ('per_hour', 'percentage', 'fixed_per_service'), pero la diferencia hace
-- ruido en toda comparación de esquemas y esconde las que sí importan.
IF EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'appointments' AND column_name = 'provider_payment_type'
              AND character_maximum_length IS NOT NULL) THEN
  ALTER TABLE appointments ALTER COLUMN provider_payment_type TYPE varchar;
  RAISE NOTICE 'appointments.provider_payment_type → varchar sin límite';
END IF;

-- `service_provider_service.payment_type` lo usa la vista
-- `provider_rates_per_hour`, y Postgres no deja cambiar el tipo de una columna
-- de la que depende una vista:
--   ERROR: cannot alter type of a column used by a view or rule
-- Hay que bajar la vista, cambiar la columna y volver a levantarla con su
-- propia definición —leída de la base, no copiada acá, para que no se
-- desincronice si alguien la edita—.
IF EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'service_provider_service' AND column_name = 'payment_type'
              AND character_maximum_length IS NOT NULL) THEN
  v_vista := pg_get_viewdef('provider_rates_per_hour'::regclass, true);
  DROP VIEW provider_rates_per_hour;
  ALTER TABLE service_provider_service ALTER COLUMN payment_type TYPE varchar;
  EXECUTE 'CREATE VIEW provider_rates_per_hour AS ' || v_vista;
  RAISE NOTICE 'service_provider_service.payment_type → varchar sin límite (vista recreada)';
END IF;

END $mig$;
