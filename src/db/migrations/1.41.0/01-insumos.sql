-- ════════════════════════════════════════════════════════════════════════════
-- 1.41.0 / 01 — Insumos: stock mínimo, costo y marca de insumo
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA. El SQL Editor de Supabase hace autocommit por sentencia:
-- si esto fueran varias, un error en el medio dejaría la base a medio armar
-- (pasó de verdad con la 1.34.0). Por eso va todo en un único bloque DO, sin
-- `CREATE TEMP TABLE ... ON COMMIT DROP` y sin `\echo`.
--
-- CONTEXTO
-- Laura pidió (2026-09-08) una pantalla de INSUMOS que sirva para dos cosas a
-- la vez: COSTEAR tratamientos y llevar STOCK, con descuento automático al
-- realizar el servicio y aviso de stock mínimo.
--
-- La tabla `products` ya existe (12 columnas, 0 filas) y tiene justo lo que un
-- insumo necesita: unidad, stock, proveedor. Se reusa en vez de crear una tabla
-- nueva, porque un mismo frasco de crema puede ser insumo de un tratamiento Y
-- producto de reventa; con dos tablas habría que cargarlo dos veces y los
-- stocks se irían separando.
--
-- Pero `products` NO estaba pensada para esto y trae dos choques que esta
-- migración resuelve:
--
--   1. `products` YA ES FACTURABLE. `line_items.product_id` la referencia y
--      `checkout`/`invoices` aceptan `productId`. Sin una marca, cada caja de
--      guantes que cargue Laura aparecería como producto vendible en el
--      facturador. Por eso `is_supply`.
--
--   2. `unit_price` YA SIGNIFICA "precio de venta" — `invoicing.service.ts` lo
--      lee para armar la factura. Para costear hace falta lo que CUESTA, que es
--      otro número. Meter el costo ahí facturaría los insumos al precio de
--      compra sin que nadie se entere. Por eso `unit_cost` aparte.
--
-- Lo que esta migración NO hace: la tabla receta (`service_product`: qué insumo
-- consume cada servicio y en qué cantidad) y el descuento automático llegan en
-- la etapa siguiente. Esto es sólo el catálogo, para que Laura pueda empezar a
-- cargar insumos mientras se construye el resto.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS`. Correrla dos veces no hace nada.

DO $$
BEGIN
  -- Cuántas unidades disparan el aviso de reposición. NULL o 0 = "no me
  -- avises": la mayoría de los insumos van a entrar sin mínimo y no tiene
  -- sentido inventarles uno.
  ALTER TABLE products ADD COLUMN IF NOT EXISTS minimum_stock integer;

  -- Lo que CUESTA la unidad, para costear tratamientos. Distinto de
  -- `unit_price`, que es a cuánto se vende.
  ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_cost numeric(10,2);

  -- true = es un insumo (se consume haciendo un servicio). Arranca en false
  -- para no convertir en insumo nada que ya existiera; hoy la tabla está vacía,
  -- así que en la práctica lo definen las altas nuevas.
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_supply boolean NOT NULL DEFAULT false;

  -- La pantalla siempre pide "los insumos activos"; sin índice eso es un seq
  -- scan sobre una tabla que sólo crece.
  CREATE INDEX IF NOT EXISTS ix_products_supply ON products (is_supply) WHERE is_supply;

  RAISE NOTICE 'products listo para insumos';
END $$;

-- ── Verificación (correr aparte, no forma parte de la migración) ────────────
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'products' AND column_name IN ('minimum_stock','unit_cost','is_supply');
