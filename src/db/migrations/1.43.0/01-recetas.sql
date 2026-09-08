-- ════════════════════════════════════════════════════════════════════════════
-- 1.43.0 / 01 — Recetas: qué insumos consume cada servicio
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA. El SQL Editor de Supabase hace autocommit por sentencia:
-- si esto fueran varias, un error en el medio dejaría la base a medio armar
-- (pasó de verdad con la 1.34.0). Por eso va todo en un único bloque DO, sin
-- `CREATE TEMP TABLE ... ON COMMIT DROP` y sin `\echo`.
--
-- POR QUÉ
-- Laura pidió que el stock baje SOLO cada vez que se realiza un servicio. Para
-- restar hay que saber CUÁNTO: una limpieza de cutis no gasta "gasas", gasta 2
-- gasas. Sin esta tabla el descuento automático no tiene de dónde salir.
--
-- La cantidad es `numeric(10,3)`, no integer: media ampolla es media ampolla, y
-- un insumo medido en ml casi nunca se consume entero. Con integer habría que
-- redondear cada consumo y el stock se iría desviando solo.
--
-- `UNIQUE (service_id, product_id)`: un servicio usa un insumo una vez, con una
-- cantidad. Dos filas del mismo par serían dos verdades sobre lo mismo y el
-- descuento no sabría cuál aplicar.
--
-- ON DELETE CASCADE en las dos FK: una receta no significa nada sin su servicio
-- ni sin su insumo. Con FK restrictiva, archivar mal un insumo se convertiría
-- en un error a mano en cada servicio que lo usa.
--
-- QUÉ NO HACE: no descuenta nada todavía. El enganche al pasar un turno a
-- `completed` es la etapa siguiente. Esto es sólo dónde se guarda la receta.
--
-- Idempotente: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.

DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS service_product (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id uuid NOT NULL REFERENCES service(id)  ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity   numeric(10,3) NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT ux_service_product UNIQUE (service_id, product_id),
    -- Una cantidad negativa SUMARÍA stock cada vez que se hace el servicio, y
    -- una en 0 es un insumo tildado que no se usa. Ninguna de las dos es una
    -- receta; la app ya las filtra, esto es la red por si entra por otro lado.
    CONSTRAINT ck_service_product_qty CHECK (quantity > 0)
  );

  -- Los dos accesos reales: "los insumos de este servicio" (el modal) y "los
  -- servicios que usan este insumo" (la carga masiva y el impacto de archivar).
  CREATE INDEX IF NOT EXISTS ix_service_product_service ON service_product (service_id);
  CREATE INDEX IF NOT EXISTS ix_service_product_product ON service_product (product_id);

  RAISE NOTICE 'service_product lista';
END $$;

-- ── Verificación (correr aparte, no forma parte de la migración) ────────────
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'service_product' ORDER BY ordinal_position;
