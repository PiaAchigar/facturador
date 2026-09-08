-- ════════════════════════════════════════════════════════════════════════════
-- 1.42.0 / 01 — Restaurar las áreas del panel y devolverle su área a cada servicio
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA. El SQL Editor de Supabase hace autocommit por sentencia:
-- si esto fueran varias, un error en el medio dejaría la base a medio armar
-- (pasó de verdad con la 1.34.0). Por eso va todo en un único bloque DO, sin
-- `CREATE TEMP TABLE ... ON COMMIT DROP` y sin `\echo`.
--
-- QUÉ PASÓ
-- La 1.37.0/02 dejó las 6 áreas creadas (con un RAISE EXCEPTION que verificaba
-- que fueran exactamente 6) y la 1.37.0/03 colgó 123 servicios de ellas.
-- Hoy en producción quedan 4, y 'Estética' está archivada:
--
--   Actividades ✓   Depilación Definitiva ✓   Capacitaciones ✓
--   Estética (ARCHIVADA)   Medicina y Dermatología ✗   Masajes y Bienestar ✗
--
-- Ninguna migración borra categorías: se borraron desde el botón de papelera
-- del dashboard, que desde la 1.38.x permite eliminar definitivamente una
-- categoría archivada. 'Medicina y Dermatología' y 'Masajes y Bienestar'
-- nacieron archivadas a propósito (ver 1.37.0/02) y en la vista de Archivados
-- parecían dos categorías vacías de un intento viejo.
--
-- El borrado se llevó puestos sus vínculos en `service_category`. Resultado:
-- 70 de los 120 servicios activos no pertenecen a ninguna área, y las pestañas
-- "Medicina y Dermatología" y "Masajes y Bienestar" del panel están vacías.
--
-- CÓMO SE REPARA
-- No se reasignan 70 servicios a mano. La 1.37.0/03 clasificaba por TÉCNICA,
-- pero la 1.38.0 renombró y mudó esas técnicas, así que aquella lista de
-- nombres ya no aplica. La regla equivalente sobre el árbol de hoy es más
-- simple y más estable: **la raíz del árbol decide el área**.
--
--   Tratamientos Faciales  ─┐
--   Aparatología            ├─→ Estética
--   Estética Corporal      ─┘
--   Tratamientos Médicos    ──→ Medicina y Dermatología
--   Masajes                ─┐
--   Belleza                 ├─→ Masajes y Bienestar
--   Manicuría y Pedicuría  ─┘
--
-- 'Promos del Mes' y 'Combos' quedan afuera a propósito: son raíces
-- comerciales, no áreas. Un servicio que sólo cuelgue de ahí sigue sin área y
-- la migración lo reporta.
--
-- Las áreas se crean/reactivan ACTIVAS. El sitio público ya filtra
-- `kind !== 'area'` (piubella_web/src/app/servicios/page.tsx), así que no puede
-- duplicar el árbol — que era el motivo por el que la 1.37.0 las dejó
-- archivadas.
--
-- Idempotente: sólo inserta lo que falta y no duplica vínculos.

DO $$
DECLARE
  v_creadas   integer := 0;
  v_activadas integer := 0;
  v_links     integer := 0;
  v_huerfanos integer;
  v_areas     integer;
BEGIN
  -- ── 1. Las áreas que faltan ────────────────────────────────────────────────
  INSERT INTO categories (id, name, kind, display_order, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), v.name, 'area', v.orden, true, now(), now()
    FROM (VALUES ('Medicina y Dermatología', 5), ('Masajes y Bienestar', 6)) AS v(name, orden)
   WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = v.name);
  GET DIAGNOSTICS v_creadas = ROW_COUNT;

  -- ── 2. Las que existen pero están archivadas ──────────────────────────────
  -- Un área archivada no se puede elegir desde el modal de Nuevo Servicio y su
  -- pestaña queda vacía. Las 6 tienen que estar activas.
  UPDATE categories SET is_active = true, updated_at = now()
   WHERE kind = 'area' AND is_active IS DISTINCT FROM true;
  GET DIAGNOSTICS v_activadas = ROW_COUNT;

  -- ── 3. Cada servicio activo a su área, según la raíz de su árbol ──────────
  WITH RECURSIVE sube AS (
    SELECT c.id, c.name, c.parent_category_id, c.id AS hoja
      FROM categories c
    UNION ALL
    SELECT p.id, p.name, p.parent_category_id, s.hoja
      FROM sube s JOIN categories p ON p.id = s.parent_category_id
  ),
  raiz AS (
    SELECT hoja, name AS root FROM sube WHERE parent_category_id IS NULL
  ),
  mapa(root, area) AS (
    VALUES
      ('Tratamientos Faciales',  'Estética'),
      ('Aparatología',           'Estética'),
      ('Estética Corporal',      'Estética'),
      ('Tratamientos Médicos',   'Medicina y Dermatología'),
      ('Masajes',                'Masajes y Bienestar'),
      ('Belleza',                'Masajes y Bienestar'),
      ('Manicuría y Pedicuría',  'Masajes y Bienestar')
  )
  INSERT INTO service_category (service_id, category_id, created_at)
  SELECT DISTINCT sc.service_id, a.id, now()
    FROM service_category sc
    JOIN service    s ON s.id = sc.service_id AND s.is_active
    JOIN raiz       r ON r.hoja = sc.category_id
    JOIN mapa       m ON m.root = r.root
    JOIN categories a ON a.kind = 'area' AND a.name = m.area
   WHERE NOT EXISTS (
     SELECT 1 FROM service_category x
      WHERE x.service_id = sc.service_id AND x.category_id = a.id
   );
  GET DIAGNOSTICS v_links = ROW_COUNT;

  -- ── 4. Control ─────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_areas FROM categories WHERE kind = 'area' AND is_active;

  SELECT count(*) INTO v_huerfanos
    FROM service s
   WHERE s.is_active AND NOT EXISTS (
     SELECT 1 FROM service_category sc
       JOIN categories c ON c.id = sc.category_id AND c.kind = 'area'
      WHERE sc.service_id = s.id);

  RAISE NOTICE 'Áreas creadas: %  reactivadas: %  activas ahora: % (tienen que ser 6)',
    v_creadas, v_activadas, v_areas;
  RAISE NOTICE 'Vínculos servicio→área nuevos: %', v_links;
  RAISE NOTICE 'Servicios activos sin área: % (los que sólo cuelgan de Promos o Combos)', v_huerfanos;

  IF v_areas <> 6 THEN
    RAISE EXCEPTION 'Se esperaban 6 áreas activas y hay %. Revisar nombres antes de seguir.', v_areas;
  END IF;
END $$;

-- ── Verificación (correr aparte, no forma parte de la migración) ────────────
-- SELECT c.name AS area, count(DISTINCT sc.service_id) AS servicios
--   FROM categories c
--   LEFT JOIN service_category sc ON sc.category_id = c.id
--   LEFT JOIN service s ON s.id = sc.service_id AND s.is_active
--  WHERE c.kind = 'area'
--  GROUP BY c.name ORDER BY 2 DESC;
