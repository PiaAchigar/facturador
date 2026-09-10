-- ═══════════════════════════════════════════════════════════════════════════
-- 1.50.0 — Combos y Packs por área
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cierra el modelo que definió Pia (spec 2026-08-27, §4.1 a §4.4):
--
--   Servicio  una cosa, una sesión
--   Combo     varios servicios distintos, UNA sesión de cada uno
--   Pack      repetición: un combo N veces, o un servicio N veces
--
-- Tres cosas entran acá:
--
--   1. El ÁREA del combo. Se elige al crearlo, no se deduce de sus servicios
--      (§4.2). Es UNA sola: combinar entre áreas es trabajo de PROMOS.
--
--   2. El PACK como fila de catálogo. Hasta ahora la repetición existía sólo
--      en el momento de vender (`customer_purchase.sessions_total`, 1.45.0).
--      Eso NO cambia: un pack de catálogo es un PRESET guardado —"este combo,
--      4 veces, con este descuento"— y al venderse produce exactamente la
--      misma compra de siempre. No hay un segundo camino de venta.
--
--   3. JUNTOS o POR SEPARADO (§4.4). Si un combo se hace en una sola visita o
--      en varias. Es un dato del catálogo; hacerlo cumplir es trabajo de la
--      agenda y llega en V3.
--
-- ⚠️ MOMENTO BARATO: `combos` y `combo_service` están VACÍAS en producción y en
-- local (verificado contra ambas el 2026-09-10), y no hay ninguna compra que
-- apunte a un combo. Por eso `area_category_id` puede quedar NOT NULL sin
-- backfill y sin pestaña de rescate, a diferencia de lo que hubo que hacer con
-- los servicios sin área en la 1.37.0.
--
-- Una sola sentencia `DO $$`: el SQL Editor de Supabase hace autocommit por
-- sentencia, así que todo lo que dependa de un paso anterior tiene que viajar
-- junto o la migración queda a medio aplicar (ver CLAUDE.md §5).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- ══ 1. Las columnas nuevas de `combos` ═════════════════════════════════════

  -- El área a la que pertenece. Apunta a `categories` de eje 'area' (1.37.0).
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS area_category_id uuid;

  -- 'combo' | 'pack'. Explícito y no deducido de las otras columnas: la UI
  -- decide en qué solapa mostrar la fila y una regla derivada obligaría a
  -- repetir el mismo `CASE` en cada consulta.
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'combo';

  -- Un pack que repite un COMBO apunta acá. Un pack que repite un SERVICIO
  -- suelto deja esto en NULL y lleva su único renglón en `combo_service`.
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS pack_of_combo_id uuid;

  -- Cuántas veces se repite. Es la identidad del pack, por eso es obligatoria
  -- cuando kind='pack' y prohibida cuando kind='combo'.
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS pack_sessions integer;

  -- El descuento propio del pack, que pisa al del área. Van de a DOS: o los dos
  -- cargados, o los dos en NULL. NULL = "usá la política del área"
  -- (`area_pack_policy`), igual que `depilation_combo` cae en
  -- `depilation_pricing_config` cuando los deja vacíos.
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS pack_discount_percentage integer;
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS pack_rounding_base integer;

  -- §4.4 — true = los servicios se hacen en la MISMA visita (mismo día; no
  -- necesariamente pegados). false = cada uno se agenda por su lado.
  --
  -- El default es false por pedido de Pia (2026-09-10): si quien carga el combo
  -- se olvida del check, lo peor que pasa es que se pueda agendar con más
  -- libertad de la ideal. Al revés bloquearía turnos que sí se podían dar.
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS services_together boolean NOT NULL DEFAULT false;

  -- ══ 2. El área es obligatoria ══════════════════════════════════════════════
  -- Sólo si no quedó ninguna fila sin área. Hoy no hay ninguna fila, punto;
  -- la guarda es para que correr esto sobre una base ya poblada no reviente.
  IF NOT EXISTS (SELECT 1 FROM combos WHERE area_category_id IS NULL) THEN
    ALTER TABLE combos ALTER COLUMN area_category_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'combos.area_category_id queda NULLABLE: hay filas sin área';
  END IF;

  -- ══ 3. Las llaves foráneas ═════════════════════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_combos_area') THEN
    ALTER TABLE combos ADD CONSTRAINT fk_combos_area
      FOREIGN KEY (area_category_id) REFERENCES categories(id);
  END IF;

  -- RESTRICT y no CASCADE: borrar un combo que tiene packs colgando tiene que
  -- fallar y avisar, no llevarse los packs en silencio.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_combos_pack_of') THEN
    ALTER TABLE combos ADD CONSTRAINT fk_combos_pack_of
      FOREIGN KEY (pack_of_combo_id) REFERENCES combos(id) ON DELETE RESTRICT;
  END IF;

  -- ══ 4. Las reglas ══════════════════════════════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_combos_kind') THEN
    ALTER TABLE combos ADD CONSTRAINT ck_combos_kind
      CHECK (kind IN ('combo', 'pack'));
  END IF;

  -- Qué puede llevar cada tipo:
  --   combo  nada de pack
  --   pack   repetición obligatoria de 2 o más, y NUNCA `services_together`
  --
  -- Lo último es a propósito: un pack repite, no combina. Si repite un combo,
  -- el "juntos" sale del combo apuntado; si repite un servicio suelto, no hay
  -- nada que juntar. Dejarlo escribir en los dos lados daría dos respuestas
  -- posibles a la misma pregunta.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_combos_pack') THEN
    ALTER TABLE combos ADD CONSTRAINT ck_combos_pack CHECK (
      (kind = 'combo' AND pack_of_combo_id IS NULL AND pack_sessions IS NULL)
      OR
      (kind = 'pack'  AND pack_sessions IS NOT NULL AND pack_sessions >= 2
                      AND services_together = false)
    );
  END IF;

  -- El descuento propio: o los dos, o ninguno, y dentro de rango.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_combos_pack_precio') THEN
    ALTER TABLE combos ADD CONSTRAINT ck_combos_pack_precio CHECK (
      (pack_discount_percentage IS NULL AND pack_rounding_base IS NULL)
      OR
      (pack_discount_percentage IS NOT NULL AND pack_rounding_base IS NOT NULL
       AND pack_discount_percentage BETWEEN 0 AND 100
       AND pack_rounding_base > 0)
    );
  END IF;

  -- ⚠️ Lo que NO se puede pedir acá: que `pack_of_combo_id` apunte a un
  -- kind='combo' (no hay packs de packs) y que un pack tenga renglones propios
  -- O apunte a un combo, nunca las dos cosas. Las dos necesitan mirar OTRA
  -- fila, y un CHECK no puede. Las valida el backend al crear el pack.

  -- ══ 5. Índices ═════════════════════════════════════════════════════════════
  -- La consulta de toda solapa: los de esta área, de este tipo, activos.
  CREATE INDEX IF NOT EXISTS idx_combos_area_kind
    ON combos (area_category_id, kind, is_active);

  -- Parcial: sólo los packs apuntan a un combo, y son la minoría.
  CREATE INDEX IF NOT EXISTS idx_combos_pack_of
    ON combos (pack_of_combo_id) WHERE pack_of_combo_id IS NOT NULL;

  -- ══ 6. El tarifario de packs por área ══════════════════════════════════════
  --
  -- Mismo trío que ya usa depilación en `depilation_pricing_config`, ahora una
  -- fila por área. Se eligió repetir la forma y no inventar una escala
  -- (2 sesiones → x%, 3 → y%, 4 → z%) porque `politicaDePack()` en
  -- `pack-pricing.ts` ya consume EXACTAMENTE estas tres columnas: el tarifario
  -- por área entra sin una sola línea de lógica de precios nueva. Un pack que
  -- no siga la política del área lleva su propio descuento (paso 1).
  CREATE TABLE IF NOT EXISTS area_pack_policy (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    area_category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    pack_sessions integer NOT NULL,
    pack_discount_percentage integer NOT NULL,
    pack_rounding_base integer NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_area_pack_policy_area
    ON area_pack_policy (area_category_id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_app_valores') THEN
    ALTER TABLE area_pack_policy ADD CONSTRAINT ck_app_valores CHECK (
      pack_sessions >= 2
      AND pack_discount_percentage BETWEEN 0 AND 100
      AND pack_rounding_base > 0
    );
  END IF;

  -- ══ 7. Sembrar las tres áreas ══════════════════════════════════════════════
  --
  -- Con los MISMOS valores que hoy tiene depilación (3 sesiones, 15%, redondeo
  -- a $1000): así el sistema se comporta igual en todas las áreas hasta que
  -- Laura decida diferenciarlas. Es de donde salía el "Pack de 3 — 15% de
  -- descuento" que ya se mostraba en pantalla.
  --
  -- Depilación NO entra: tiene su propio motor y su propia config.
  --
  -- ⚠️ Sin variables de PL/pgSQL, y a propósito. La primera versión juntaba los
  -- ids en un `uuid[]` y lo desarmaba con `SELECT unnest(v_areas)`. Por psql
  -- anda —probado contra PG 15.4 y PG 17.11— pero el SQL Editor de Supabase lo
  -- rechazó con `42P01: relation "v_areas" does not exist` (2026-09-10). No se
  -- pudo reproducir qué hace el editor con esa consulta, así que se sacó el
  -- construido entero en vez de adivinar: el INSERT lee de `categories`
  -- directo, que es más simple y no depende de nada raro.
  --
  -- La guarda va antes y por separado. Si las tres áreas no están, algo se
  -- renombró y sembrar a medias dejaría un área sin tarifario y sus packs sin
  -- precio, en silencio.
  IF (
    SELECT count(*) FROM categories
    WHERE kind = 'area'
      AND name IN ('Estética', 'Medicina y Dermatología', 'Masajes y Bienestar')
  ) <> 3 THEN
    RAISE EXCEPTION 'Esperaba las 3 áreas de catálogo (Estética, Medicina y Dermatología, Masajes y Bienestar) y no están todas';
  END IF;

  INSERT INTO area_pack_policy (area_category_id, pack_sessions, pack_discount_percentage, pack_rounding_base)
  SELECT id, 3, 15, 1000
  FROM categories
  WHERE kind = 'area'
    AND name IN ('Estética', 'Medicina y Dermatología', 'Masajes y Bienestar')
  ON CONFLICT (area_category_id) DO NOTHING;

  RAISE NOTICE '1.50.0 aplicada: combos con área/kind/pack/juntos + area_pack_policy sembrada';
END $$;

-- ── Verificación (correr aparte, NO dentro del bloque) ──────────────────────
--
-- Sin meta-comandos de psql (los que empiezan con backslash): el SQL Editor de
-- Supabase no los entiende, y dejarlos escritos acá invita a pegarlos por error.
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'combos'
--    AND column_name IN ('area_category_id', 'kind', 'pack_of_combo_id',
--                        'pack_sessions', 'pack_discount_percentage',
--                        'pack_rounding_base', 'services_together')
--  ORDER BY column_name;
--
-- SELECT c.name AS area, p.pack_sessions, p.pack_discount_percentage, p.pack_rounding_base
--   FROM area_pack_policy p JOIN categories c ON c.id = p.area_category_id
--  ORDER BY c.name;
