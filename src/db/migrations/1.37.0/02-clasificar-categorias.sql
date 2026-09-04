-- 1.37.0 / 02 — Asignar su eje a cada categoría
--
-- La 01 dejó las 73 en 'tecnica' por default. Acá se marcan las excepciones.
-- Las listas salieron de leer las categorías reales de producción el
-- 2026-08-27; no son un supuesto.
--
-- Cuatro de las seis áreas YA EXISTEN como categorías (algunas archivadas y
-- vacías, de un intento anterior). Se reusan en vez de crear duplicados: si se
-- crearan de nuevo, quedarían dos "Estética" y el árbol de la web mostraría las
-- dos.
--
-- Una sola sentencia: el SQL Editor de Supabase hace autocommit por sentencia.
DO $$
DECLARE
  v_areas text[] := ARRAY[
    'Estética', 'Depilación Definitiva', 'Actividades', 'Capacitaciones'
  ];
  v_maquinas text[] := ARRAY[
    'Alpha Synergy', 'Crio-Radiofrecuencia', 'Criolipólisis', 'HIFU Corporal',
    'Mio Up', 'Vela Slim', 'Venus Legacy', 'Lipoláser', 'Presoterapia',
    'Ultracavitación', 'Ondas de Choque (Hammer)', 'Electrodos / Ondas Rusas',
    'Mantas y Electrodos Térmicos', 'Radiofrecuencia Corporal'
  ];
  v_objetivos text[] := ARRAY[
    'Arrugas', 'Manchas', 'Cicatrices', 'Estrías', 'Celulitis', 'Flaccidez',
    'Tonificar', 'Adiposidad Localizada', 'Reductor General', 'Drenaje Linfático',
    'Ojeras y Contorno de Ojos', 'Labios', 'Tratamiento Capilar',
    'Rejuvenecimiento Íntimo', 'Abdomen', 'Brazos', 'Glúteos', 'Corporal', 'Facial'
  ];
  v_faltan text[] := ARRAY['Medicina y Dermatología', 'Masajes y Bienestar'];
  v_n integer;
BEGIN
  UPDATE categories SET kind = 'area',     updated_at = now() WHERE name = ANY(v_areas);
  UPDATE categories SET kind = 'maquina',  updated_at = now() WHERE name = ANY(v_maquinas);
  UPDATE categories SET kind = 'objetivo', updated_at = now() WHERE name = ANY(v_objetivos);

  -- Las dos áreas que no existían todavía. Nacen ARCHIVADAS a propósito.
  INSERT INTO categories (id, name, kind, display_order, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), n, 'area', 0, false, now(), now()
  FROM unnest(v_faltan) AS n
  WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = n);

  -- ⚠️ ACÁ NO SE ACTIVA NINGUNA ÁREA, y es deliberado.
  --
  -- El sitio público arma su árbol con las categorías ACTIVAS que tengan
  -- servicios (`piubella_web/src/app/servicios/page.tsx`), y la 03 les va a
  -- colgar 123. Si se activaran ahora, en la próxima revalidación de ISR —una
  -- hora— el sitio mostraría "Estética", "Medicina y Dermatología" y "Masajes
  -- y Bienestar" duplicando todo el árbol, porque cada servicio ya cuelga de
  -- su técnica.
  --
  -- Archivadas, la clasificación queda completa y el sitio no puede verlas ni
  -- aunque el filtro por `kind` de la web no estuviera deployado. Las activa
  -- E2, que es la etapa que construye las pestañas y la única que las
  -- necesita visibles.

  SELECT count(*) INTO v_n FROM categories WHERE kind = 'area';
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'Se esperaban 6 áreas y hay %. Revisar nombres antes de seguir.', v_n;
  END IF;

  RAISE NOTICE 'area=% tecnica=% objetivo=% maquina=%',
    v_n,
    (SELECT count(*) FROM categories WHERE kind = 'tecnica'),
    (SELECT count(*) FROM categories WHERE kind = 'objetivo'),
    (SELECT count(*) FROM categories WHERE kind = 'maquina');
END $$;
