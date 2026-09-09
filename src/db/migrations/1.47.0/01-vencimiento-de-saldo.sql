-- ════════════════════════════════════════════════════════════════════════════
-- 1.47.0 — El saldo a favor vence
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA (bloque DO): el SQL Editor de Supabase hace autocommit por
-- sentencia y varias sentencias dejarían la migración a medio aplicar.
--
-- Regla de Laura (2026-09-09): la plata a favor se puede usar durante 3 meses.
-- Pasado ese plazo se pierde y pasa a la caja.
--
-- ¿POR QUÉ UNA COLUMNA Y NO `created_at + 3 meses` CALCULADO?
-- Porque a la clienta se le dijo una fecha. Si mañana Laura baja la vigencia a
-- 1 mes, el saldo de alguien que acredita hoy no puede vencer de golpe la
-- semana que viene: la regla nueva rige para lo nuevo. Guardar la fecha al
-- acreditar es lo que hace que eso sea cierto.
--
-- NULLABLE a propósito: los movimientos que ya existen se acreditaron sin
-- plazo, y ponerles uno ahora sería vencer retroactivamente plata que se
-- prometió sin vencimiento. NULL = no vence, que es lo que se les prometió.

DO $$
BEGIN
  ALTER TABLE customer_credit_movements
    ADD COLUMN IF NOT EXISTS expires_at timestamp;

  -- El listado de vencidos barre por fecha sobre toda la tabla. Parcial porque
  -- sólo las acreditaciones (amount > 0) tienen vencimiento: los consumos son
  -- negativos y nunca se consultan por acá.
  CREATE INDEX IF NOT EXISTS ix_ccm_expira
    ON customer_credit_movements (expires_at)
    WHERE amount > 0 AND expires_at IS NOT NULL;

  RAISE NOTICE '1.47.0 aplicada: customer_credit_movements.expires_at';
END $$;

-- Verificación (correr aparte):
-- SELECT count(*) FILTER (WHERE expires_at IS NULL) AS sin_plazo,
--        count(*) FILTER (WHERE expires_at IS NOT NULL) AS con_plazo
--   FROM customer_credit_movements WHERE amount > 0;
