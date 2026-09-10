-- 1.49.0 — Perdonar el vencimiento de un saldo a favor ("Ignorar")
--
-- El aviso de saldos vencidos hoy ofrece una sola salida: pasar la plata a la
-- caja. Falta la otra, que es la que Laura va a usar seguido: dejársela a la
-- clienta igual y que el aviso deje de nombrarla.
--
-- POR QUÉ VA EN EL MOVIMIENTO Y NO EN EL CLIENTE
-- Perdonarle a Sofía los $80.000 que se le vencieron en julio no puede
-- silenciar el saldo que se le venza el año que viene por otra cancelación.
-- Con una marca por cliente, el segundo vencimiento quedaría callado y sería
-- plata que nadie miró nunca. La marca es de ESA acreditación.
--
-- NO TOCA LA PLATA. `credit_balance` queda igual y la clienta puede seguir
-- usando ese saldo en una venta. Perdonar cambia a quién avisa el sistema, no
-- de quién es el dinero. La única acción que mueve plata sigue siendo
-- "Pasar a caja", que escribe el movimiento negativo `expired`.
--
-- Reversible: poner la columna en NULL devuelve el lote al aviso.
--
-- `timestamp` sin zona, como el resto de la tabla (created_at, expires_at):
-- todo el sistema guarda UTC en columnas naive. Una timestamptz acá se
-- compararía contra las otras dos con un corrimiento de horas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_credit_movements'
      AND column_name = 'expiry_ignored_at'
  ) THEN
    ALTER TABLE customer_credit_movements
      ADD COLUMN expiry_ignored_at timestamp;

    COMMENT ON COLUMN customer_credit_movements.expiry_ignored_at IS
      'Cuándo se decidió dejarle a la clienta esta acreditación vencida. '
      'NULL = sin decidir, aparece en el aviso de saldos vencidos. '
      'No afecta credit_balance: la plata sigue siendo de la clienta.';

    -- Parcial: las filas que importan son las poquitas perdonadas, no las
    -- miles con NULL. El índice ordena por fecha porque la ficha de la
    -- clienta las muestra de la más reciente para atrás.
    CREATE INDEX idx_ccm_expiry_ignored
      ON customer_credit_movements (customer_id, expiry_ignored_at DESC)
      WHERE expiry_ignored_at IS NOT NULL;

    RAISE NOTICE 'expiry_ignored_at agregada.';
  ELSE
    RAISE NOTICE 'expiry_ignored_at ya existía, no se toca.';
  END IF;
END $$;

-- Verificación (correr aparte):
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'customer_credit_movements' AND column_name = 'expiry_ignored_at';
