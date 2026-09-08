-- ════════════════════════════════════════════════════════════════════════════
-- 1.40.0 / 01 — Historial de reagendamientos
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA. El SQL Editor de Supabase hace autocommit por sentencia:
-- si esto fueran varias, un error en el medio dejaría la base a medio armar
-- (pasó de verdad con la 1.34.0). Por eso va todo en un único bloque DO, sin
-- `CREATE TEMP TABLE ... ON COMMIT DROP` y sin `\echo`.
--
-- QUÉ ARREGLA
-- `PATCH /api/agenda/appointments/:id/reschedule` hace UPDATE sobre
-- `appointments.appointment_start` / `appointment_end`. El valor anterior se
-- pisa y no queda en ningún lado: no hay trigger de auditoría sobre
-- `appointments` ni tabla que lo cubra. Hoy nadie puede responder "¿este turno
-- estaba a las 10 y lo movieron, o siempre estuvo a las 15?", ni quién lo
-- movió, ni por qué.
--
-- Esta tabla es append-only: una fila por movimiento, con el antes y el
-- después. No reemplaza a `appointments` — la fila vigente sigue siendo la del
-- turno; esto es el rastro de cómo llegó ahí.
--
-- POR QUÉ TABLA NUEVA Y NO `provider_availability_audit`
-- Esa tabla audita la DISPONIBILIDAD de una proveedora (§3.4 de
-- reglas_negocio.md) y su `old_values`/`new_values` son jsonb libres. Un turno
-- movido necesita columnas tipadas para poder ordenarlo y mostrarlo por fecha
-- sin castear jsonb en cada consulta.
--
-- ON DELETE CASCADE en `appointment_id`: hoy nada borra turnos por SQL, pero si
-- alguna vez se borra uno, su historial no tiene sentido sin él y una FK
-- restrictiva convertiría el borrado en un error a mano.
--
-- `rescheduled_by_user_id` NO lleva FK: el `sub` del JWT de Supabase vive en
-- `auth.users`, un esquema al que esta base no referencia desde ninguna otra
-- tabla de negocio (`provider_availability_audit.changed_by_user_id` tampoco).
--
-- Idempotente: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
-- Correrla dos veces no duplica nada.

DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS appointment_reschedule (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id            uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    previous_start            timestamp,
    previous_end              timestamp,
    previous_duration_minutes integer,
    new_start                 timestamp NOT NULL,
    new_end                   timestamp NOT NULL,
    new_duration_minutes      integer,
    reason                    text,
    rescheduled_by_user_id    uuid,
    created_at                timestamp NOT NULL DEFAULT now()
  );

  -- El acceso real es siempre "el historial de ESTE turno, del más nuevo al más
  -- viejo". Sin el índice, cada apertura del modal de reagendado hace un seq
  -- scan sobre una tabla que sólo crece.
  CREATE INDEX IF NOT EXISTS ix_appointment_reschedule_appt
    ON appointment_reschedule (appointment_id, created_at DESC);

  RAISE NOTICE 'appointment_reschedule lista';
END $$;

-- ── Verificación (correr aparte, no forma parte de la migración) ────────────
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'appointment_reschedule'
--  ORDER BY ordinal_position;
--
-- SELECT indexname FROM pg_indexes WHERE tablename = 'appointment_reschedule';
