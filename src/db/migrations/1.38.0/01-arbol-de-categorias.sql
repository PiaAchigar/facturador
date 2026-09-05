-- ════════════════════════════════════════════════════════════════════════════
-- 1.38.0 / 01 — El árbol de categorías, acomodado
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/superpowers/specs/2026-09-04-arbol-de-categorias-design.md
--
-- CUATRO REGLAS, decididas por Pia el 2026-09-04:
--
--   1. Se CREA sólo lo que no existe. Si la categoría nueva y una vieja son la
--      misma cosa, se MUEVE la vieja — se lleva sus servicios sola, porque el
--      vínculo de `service_category` es por id, no por nombre.
--   2. Ningún servicio PIERDE categorías: sólo gana. La única excepción son los
--      vínculos a `Estética(Eje)` y `General(Eje)`, restos archivados de la
--      1.26.0 que están pegados a 109 y 9 servicios sin que nadie los vea.
--   3. Se archiva poco y sólo con destino cumplido: cinco categorías cuyo rol
--      queda enteramente cubierto por otra. Archivar NO borra el vínculo, así
--      que volver atrás es desarchivar.
--   4. Un nombre repetido en dos ramas son DOS categorías, con sufijo. Un nodo
--      con varios padres no se puede (`parent_category_id` es una columna sola)
--      y tampoco convendría: un nodo compartido aparece bajo todos sus padres
--      con todos sus servicios, y "Limpieza de Cutis con Dermapen" terminaría
--      saliendo en el sitio público adentro de la rama médica.
--
-- UNA SOLA SENTENCIA. El SQL Editor de Supabase hace autocommit por sentencia:
-- partida en varias, un error a mitad de camino deja el árbol roto. Todo va
-- dentro del `DO $mig$ ... END $mig$;`.
--
-- IDEMPOTENTE: se puede correr más de una vez. Cada categoría se busca por
-- (nombre, padre) antes de crearse, cada vínculo lleva su guarda `NOT EXISTS`,
-- y los renombres no encuentran nada la segunda vez.
--
-- El árbol entero está en la lista `rutas` de más abajo, con `|` de separador.
-- Esa lista es la fuente de verdad: si algo no está ahí, no se crea.
-- ════════════════════════════════════════════════════════════════════════════

DO $mig$
DECLARE
  -- Mapa ruta → id. Se llena a medida que el árbol se recorre por profundidad,
  -- así cuando toca una hija su madre ya está adentro.
  mapa        jsonb := '{}'::jsonb;

  v_faciales  uuid;
  v_cosmeto   uuid;   -- "Tratamientos Cosmetológicos" (era la raíz Cosmetología)
  v_aparato   uuid;
  v_medicos   uuid;
  v_derma     uuid;   -- "Dermatología", hoy raíz
  v_derm_est  uuid;
  v_facial    uuid;   -- el "Facial" NUEVO, hijo de Dermatología Estética
  v_est_corp  uuid;   -- "Estética Corporal", que se queda
  v_masajes   uuid;

  v_id        uuid;
  v_padre     uuid;
  v_nombre    text;
  r           record;

  v_borrar    uuid[];
  n_filas     int := 0;
  n_creadas   int := 0;
  n_ordenadas int := 0;
  n_movidas   int := 0;
  n_vinculos  int := 0;
  n_faltantes int := 0;
BEGIN

-- ── A · Renombres ──────────────────────────────────────────────────────────
-- Van primero: el paso D busca cada categoría por su nombre FINAL, así que si
-- corrieran después, D crearía duplicados en vez de encontrar las que ya están.
-- Cada UPDATE se ancla al padre además del nombre, porque varios de estos
-- nombres existen en más de una rama.

SELECT id INTO v_est_corp FROM categories
 WHERE name = 'Estética Corporal' AND parent_category_id IS NULL;
SELECT id INTO v_derma     FROM categories WHERE name = 'Dermatología';
SELECT id INTO v_derm_est  FROM categories
 WHERE name = 'Dermatología Estética' AND parent_category_id = v_derma;
SELECT id INTO v_masajes   FROM categories
 WHERE name = 'Masajes' AND parent_category_id IS NULL;

UPDATE categories SET name = 'Tratamientos Cosmetológicos', updated_at = now()
 WHERE name = 'Cosmetología' AND parent_category_id IS NULL;

UPDATE categories SET name = 'Limpieza de cutis', updated_at = now()
 WHERE name = 'Limpieza de Cutis y Cosmetología';

UPDATE categories SET name = 'Manicuría y Pedicuría', updated_at = now()
 WHERE name = 'Manicuría' AND parent_category_id IS NULL;

UPDATE categories SET name = 'Vela Slim plus', updated_at = now()
 WHERE name = 'Vela Slim' AND parent_category_id = v_est_corp;

UPDATE categories SET name = 'Cicatrices de acné', updated_at = now()
 WHERE name = 'Cicatrices' AND parent_category_id = v_derm_est;

UPDATE categories SET name = 'Manchas (dermatología)', updated_at = now()
 WHERE name = 'Manchas' AND parent_category_id = v_derm_est;

UPDATE categories SET name = 'Arrugas y Flaccidez', updated_at = now()
 WHERE name = 'Arrugas' AND parent_category_id = v_derm_est;

UPDATE categories SET name = 'Contorno de ojos y párpados', updated_at = now()
 WHERE name = 'Ojeras y Contorno de Ojos' AND parent_category_id = v_derm_est;

UPDATE categories SET name = 'Armonización de Labios', updated_at = now()
 WHERE name = 'Labios' AND parent_category_id = v_derm_est;

-- ── B · Las tres raíces nuevas y el "Facial" médico ────────────────────────
-- Explícitas y antes que el resto porque el paso C las necesita como destino.

SELECT id INTO v_faciales FROM categories
 WHERE name = 'Tratamientos Faciales' AND parent_category_id IS NULL;
IF v_faciales IS NULL THEN
  INSERT INTO categories (id, parent_category_id, name, kind, display_order, is_active, created_at, updated_at)
  VALUES (gen_random_uuid(), NULL, 'Tratamientos Faciales', 'tecnica', 1, true, now(), now())
  RETURNING id INTO v_faciales;
  n_creadas := n_creadas + 1;
END IF;

SELECT id INTO v_aparato FROM categories
 WHERE name = 'Aparatología' AND parent_category_id IS NULL;
IF v_aparato IS NULL THEN
  INSERT INTO categories (id, parent_category_id, name, kind, display_order, is_active, created_at, updated_at)
  VALUES (gen_random_uuid(), NULL, 'Aparatología', 'tecnica', 2, true, now(), now())
  RETURNING id INTO v_aparato;
  n_creadas := n_creadas + 1;
END IF;

SELECT id INTO v_medicos FROM categories
 WHERE name = 'Tratamientos Médicos' AND parent_category_id IS NULL;
IF v_medicos IS NULL THEN
  INSERT INTO categories (id, parent_category_id, name, kind, display_order, is_active, created_at, updated_at)
  VALUES (gen_random_uuid(), NULL, 'Tratamientos Médicos', 'tecnica', 3, true, now(), now())
  RETURNING id INTO v_medicos;
  n_creadas := n_creadas + 1;
END IF;

SELECT id INTO v_facial FROM categories
 WHERE name = 'Facial' AND parent_category_id = v_derm_est;
IF v_facial IS NULL THEN
  INSERT INTO categories (id, parent_category_id, name, kind, display_order, is_active, created_at, updated_at)
  VALUES (gen_random_uuid(), v_derm_est, 'Facial', 'objetivo', 2, true, now(), now())
  RETURNING id INTO v_facial;
  n_creadas := n_creadas + 1;
END IF;

SELECT id INTO v_cosmeto FROM categories WHERE name = 'Tratamientos Cosmetológicos';

-- ── C · Mudanzas ───────────────────────────────────────────────────────────
-- Cada UPDATE se lleva la categoría con TODOS sus servicios: el vínculo es por
-- id, así que nadie se desengancha de nada.

UPDATE categories SET parent_category_id = v_faciales, updated_at = now()
 WHERE id = v_cosmeto AND parent_category_id IS DISTINCT FROM v_faciales;
GET DIAGNOSTICS n_filas = ROW_COUNT; n_movidas := n_movidas + n_filas;

-- Hidratación de Labios es cosmetológica, no médica: "Armonización de Labios"
-- (ácido hialurónico, hialuronidasa) es otra cosa y vive en la rama médica.
UPDATE categories SET parent_category_id = v_faciales, updated_at = now()
 WHERE name = 'Hidratación de Labios' AND parent_category_id IS DISTINCT FROM v_faciales;
GET DIAGNOSTICS n_filas = ROW_COUNT; n_movidas := n_movidas + n_filas;

UPDATE categories SET parent_category_id = v_cosmeto, updated_at = now()
 WHERE name = 'Limpieza de cutis' AND parent_category_id IS DISTINCT FROM v_cosmeto;
GET DIAGNOSTICS n_filas = ROW_COUNT; n_movidas := n_movidas + n_filas;

-- Las 14 máquinas que colgaban de Estética Corporal. Se van TODAS por kind, no
-- por lista de nombres: una lista se desactualiza y deja una máquina huérfana.
-- Estética Corporal se queda con sus 4 servicios de cosmetología corporal
-- (Limpieza de Espalda, de Glúteos, Pulido con Punta de Diamante) y con sus
-- objetivos y Mesoterapia Corporal.
UPDATE categories SET parent_category_id = v_aparato, updated_at = now()
 WHERE parent_category_id = v_est_corp AND kind = 'maquina';
GET DIAGNOSTICS n_filas = ROW_COUNT; n_movidas := n_movidas + n_filas;

UPDATE categories SET parent_category_id = v_medicos, updated_at = now()
 WHERE id = v_derma AND parent_category_id IS DISTINCT FROM v_medicos;
GET DIAGNOSTICS n_filas = ROW_COUNT; n_movidas := n_movidas + n_filas;

-- Las seis hijas de Dermatología Estética que pasan a colgar de Facial. Las
-- otras —Tratamiento Capilar, Estrías, Rejuvenecimiento Íntimo, Brazos,
-- Abdomen, Glúteos— NO se tocan: se quedan donde están, con sus servicios.
UPDATE categories SET parent_category_id = v_facial, updated_at = now()
 WHERE parent_category_id = v_derm_est
   AND name IN ('Cicatrices de acné', 'Manchas (dermatología)', 'Arrugas y Flaccidez',
                'Contorno de ojos y párpados', 'Armonización de Labios', 'Rinomodelación');
GET DIAGNOSTICS n_filas = ROW_COUNT; n_movidas := n_movidas + n_filas;

-- ── D · El árbol entero ────────────────────────────────────────────────────
-- Se recorre por profundidad, así la madre siempre está en `mapa` antes que la
-- hija. Cada nodo se busca por (nombre, padre) y sólo se crea si falta, así que
-- los que ya existen se reusan con todos sus servicios en vez de duplicarse.

FOR r IN
  SELECT ruta, kind, orden, array_length(string_to_array(ruta, '|'), 1) AS prof
    FROM (VALUES
      -- ── Tratamientos Faciales ──
      ('Tratamientos Faciales', 'tecnica', 1),
      ('Tratamientos Faciales|Tratamientos Cosmetológicos', 'tecnica', 1),
      ('Tratamientos Faciales|Tratamientos Cosmetológicos|Limpieza de cutis', 'tecnica', 1),
      ('Tratamientos Faciales|Tratamientos Cosmetológicos|Dermaplaning', 'tecnica', 2),
      ('Tratamientos Faciales|Tratamientos Cosmetológicos|Peeling', 'tecnica', 3),
      ('Tratamientos Faciales|Hidratación de Labios', 'tecnica', 2),
      ('Tratamientos Faciales|Rejuvenecimiento Facial', 'objetivo', 3),
      ('Tratamientos Faciales|Manchas', 'objetivo', 4),
      ('Tratamientos Faciales|Acné y marcas de acné', 'objetivo', 5),
      ('Tratamientos Faciales|Ojeras', 'objetivo', 6),
      ('Tratamientos Faciales|Rosácea', 'objetivo', 7),
      ('Tratamientos Faciales|Dermapen Tratamiento Facial', 'tecnica', 8),
      ('Tratamientos Faciales|Rutina de cuidado facial', 'tecnica', 9),

      -- ── Aparatología ──
      ('Aparatología', 'tecnica', 2),
      ('Aparatología|Venus Legacy', 'maquina', 1),
      ('Aparatología|Mio Up', 'maquina', 2),
      ('Aparatología|Criolipólisis', 'maquina', 3),
      ('Aparatología|Vela Slim plus', 'maquina', 4),
      ('Aparatología|Lipoláser', 'maquina', 5),
      ('Aparatología|Presoterapia', 'maquina', 6),
      ('Aparatología|Electrodos / Ondas Rusas', 'maquina', 7),
      ('Aparatología|Crio-Radiofrecuencia', 'maquina', 8),
      ('Aparatología|Ondas de Choque (Hammer)', 'maquina', 9),
      ('Aparatología|Alpha Synergy', 'maquina', 10),
      ('Aparatología|HIFU Corporal', 'maquina', 11),
      ('Aparatología|Ultracavitación', 'maquina', 12),
      ('Aparatología|Mantas y Electrodos Térmicos', 'maquina', 13),
      ('Aparatología|Radiofrecuencia Corporal', 'maquina', 14),
      ('Aparatología|Mesoterapia Virtual', 'maquina', 15),
      ('Aparatología|Aparatología Cosmetológica', 'tecnica', 16),
      ('Aparatología|Aparatología Cosmetológica|HIFU 12D', 'maquina', 1),
      ('Aparatología|Aparatología Cosmetológica|Radiofrecuencia Fraccionada', 'maquina', 2),
      ('Aparatología|Aparatología Cosmetológica|Luz Pulsada IPL - Fotorejuvenecimiento', 'maquina', 3),
      ('Aparatología|Aparatología Cosmetológica|Radiofrecuencia Facial', 'maquina', 4),
      ('Aparatología|Aparatología Cosmetológica|Dermapen Cosmetológico', 'maquina', 5),

      -- ── Masajes · Belleza · Manicuría (las tres raíces ya existen) ──
      ('Masajes', 'tecnica', 6),
      ('Masajes|Masajes Relajantes', 'tecnica', 1),
      ('Masajes|Masajes Descontracturantes', 'tecnica', 2),
      ('Masajes|Masajes Drenaje Linfático', 'tecnica', 3),
      ('Masajes|Reflexología', 'tecnica', 4),

      ('Belleza', 'tecnica', 5),
      ('Belleza|Perfilado de cejas', 'tecnica', 1),
      ('Belleza|Lifting de pestañas', 'tecnica', 2),
      ('Belleza|Permanente de pestañas', 'tecnica', 3),
      ('Belleza|Alisado de cejas', 'tecnica', 4),
      ('Belleza|Depilación Facial con Hilo', 'tecnica', 5),

      ('Manicuría y Pedicuría', 'tecnica', 7),
      ('Manicuría y Pedicuría|Pedicuría', 'tecnica', 1),
      ('Manicuría y Pedicuría|Esmaltado con Semi Permanente', 'tecnica', 2),
      ('Manicuría y Pedicuría|Kapping', 'tecnica', 3),
      ('Manicuría y Pedicuría|Esculpidas', 'tecnica', 4),
      ('Manicuría y Pedicuría|Esmalte común', 'tecnica', 5),

      -- ── Tratamientos Médicos › Dermatología ──
      ('Tratamientos Médicos', 'tecnica', 3),
      ('Tratamientos Médicos|Dermatología', 'tecnica', 1),

      ('Tratamientos Médicos|Dermatología|Dermatología Clínica', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Revisión de lunares y manchas', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades inflamatorias y crónicas', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades inflamatorias y crónicas|Acné (dermatología)', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades inflamatorias y crónicas|Rosácea (dermatología)', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades inflamatorias y crónicas|Psoriasis', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades inflamatorias y crónicas|Dermatitis atópica', 'objetivo', 4),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades inflamatorias y crónicas|Dermatitis por contacto', 'objetivo', 5),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Infecciones de la piel', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Infecciones de la piel|Infecciones por hongos', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Infecciones de la piel|Infecciones bacterianas', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Infecciones de la piel|Infecciones por parásitos', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Cáncer de piel y lesiones precursoras', 'objetivo', 4),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Cáncer de piel y lesiones precursoras|Melanoma', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Cáncer de piel y lesiones precursoras|Carcinomas (Basocelular y Espinocelular)', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Cáncer de piel y lesiones precursoras|Queratosis actínicas', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades autoinmunes y sistémicas', 'objetivo', 5),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades autoinmunes y sistémicas|Lupus cutáneo', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades autoinmunes y sistémicas|Vitíligo', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Enfermedades autoinmunes y sistémicas|Alopecia areata', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Alteraciones del pelo y las uñas', 'objetivo', 6),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Alteraciones del pelo y las uñas|Alopecias', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica|Alteraciones del pelo y las uñas|Onicomicosis', 'objetivo', 2),

      ('Tratamientos Médicos|Dermatología|Dermatología Estética', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Consulta', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Cicatrices de acné', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Cicatrices de acné|PRP para cicatrices y acné', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Cicatrices de acné|Dermapen para cicatrices y acné', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Manchas (dermatología)', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Manchas (dermatología)|Melasma', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Manchas (dermatología)|PRP para manchas', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Manchas (dermatología)|Dermapen para manchas', 'tecnica', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Botox', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores|Radiesse', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores|Novuma', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores|Profhilo', 'tecnica', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Ácido Hialurónico para arrugas', 'tecnica', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|PRP para arrugas y flaccidez', 'tecnica', 4),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Mesoterapia', 'tecnica', 5),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Dermapen para arrugas y flaccidez', 'tecnica', 6),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Contorno de ojos y párpados', 'objetivo', 4),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Contorno de ojos y párpados|Sunekos', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Contorno de ojos y párpados|Ácido Hialurónico para contorno de ojos', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Armonización de Labios', 'objetivo', 5),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Armonización de Labios|Relleno con Ácido Hialurónico', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Armonización de Labios|Hialuronidasa', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Armonización Facial', 'objetivo', 6),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Rinomodelación', 'objetivo', 7),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Bruxismo', 'objetivo', 8),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Tratamientos Reductores', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Flaccidez (dermatología)', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Celulitis (dermatología)', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Hiperhidrosis', 'objetivo', 4),

      ('Tratamientos Médicos|Dermatología|Medicina Regenerativa', 'tecnica', 3),
      ('Tratamientos Médicos|Dermatología|Medicina Regenerativa|Infiltración de Plasma Rico en Plaquetas (PRP)', 'tecnica', 1),

      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica', 'tecnica', 4),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Extracción de lesiones benignas', 'tecnica', 1),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Extracción de lesiones benignas|Verrugas vulgares y acrocordones', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Extracción de lesiones benignas|Hiperplasias sebáceas', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Extracción de lesiones benignas|Quistes sebáceos', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Extracción de lesiones benignas|Lipomas (bolitas de grasa)', 'objetivo', 4),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Control y cirugía de lesiones sospechosas', 'tecnica', 2),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Control y cirugía de lesiones sospechosas|Extracción y control de lunares', 'objetivo', 1),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Control y cirugía de lesiones sospechosas|Tratamiento de carcinomas', 'objetivo', 2),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Control y cirugía de lesiones sospechosas|Eliminación de queratosis actínicas y seborreicas', 'objetivo', 3),
      ('Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Biopsias cutáneas con estudio patológico', 'tecnica', 3)
    ) AS v(ruta, kind, orden)
   ORDER BY array_length(string_to_array(ruta, '|'), 1), orden
LOOP
  v_nombre := split_part(r.ruta, '|', r.prof);

  IF r.prof = 1 THEN
    v_padre := NULL;
  ELSE
    v_padre := (mapa ->> array_to_string((string_to_array(r.ruta, '|'))[1:r.prof - 1], '|'))::uuid;
    IF v_padre IS NULL THEN
      RAISE EXCEPTION 'Sin madre para "%": la lista está mal ordenada o le falta una fila', r.ruta;
    END IF;
  END IF;

  SELECT id INTO v_id FROM categories
   WHERE name = v_nombre AND parent_category_id IS NOT DISTINCT FROM v_padre;

  IF v_id IS NULL THEN
    INSERT INTO categories (id, parent_category_id, name, kind, display_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_padre, v_nombre, r.kind, r.orden, true, now(), now())
    RETURNING id INTO v_id;
    n_creadas := n_creadas + 1;
  ELSE
    -- La que ya existía se queda con sus servicios pero adopta el orden y el
    -- eje de la lista. Sin esto, una categoría que se mudó conserva el
    -- display_order del lugar de donde vino y aparece en cualquier posición
    -- dentro de su rama nueva: "Tratamientos Cosmetológicos" traía el 3 de
    -- cuando era raíz y salía después de "Rejuvenecimiento Facial".
    UPDATE categories
       SET display_order = r.orden, kind = r.kind, updated_at = now()
     WHERE id = v_id
       AND (display_order IS DISTINCT FROM r.orden OR kind IS DISTINCT FROM r.kind);
    GET DIAGNOSTICS n_filas = ROW_COUNT; n_ordenadas := n_ordenadas + n_filas;
  END IF;

  mapa := mapa || jsonb_build_object(r.ruta, v_id::text);
END LOOP;

-- La descripción que pidió Pia para la consulta de Dermatología Estética.
UPDATE categories
   SET description = 'Asesoramiento, evaluación, protocolo personalizado según objetivo del paciente',
       updated_at  = now()
 WHERE id = (mapa ->> 'Tratamientos Médicos|Dermatología|Dermatología Estética|Consulta')::uuid;

-- ── E · Los servicios ganan sus categorías nuevas ──────────────────────────
-- Nadie pierde nada: esto sólo AGREGA vínculos. Los servicios que están en una
-- categoría que se movió o se renombró no aparecen acá — viajaron con ella.

FOR r IN
  SELECT servicio, ruta FROM (VALUES
    -- Belleza
    ('Perfilado de cejas',                          'Belleza|Perfilado de cejas'),
    ('Perfilado de cejas con visagismo',            'Belleza|Perfilado de cejas'),
    ('Lifting de pestañas',                         'Belleza|Lifting de pestañas'),
    ('Laminado/Alisado de cejas',                   'Belleza|Alisado de cejas'),
    ('Depilación facial con hilo',                  'Belleza|Depilación Facial con Hilo'),
    ('Depilación facial con hilo - solo bozo',      'Belleza|Depilación Facial con Hilo'),

    -- Manicuría y Pedicuría. Los cinco "extras" (Difuminado, French, Polvo
    -- brillo, Decoración, Diseño simple) no aparecen: son adicionales, no una
    -- técnica, y se quedan colgando de la madre.
    ('Belleza de manos con esmalte común',                                        'Manicuría y Pedicuría|Esmalte común'),
    ('Belleza de manos con esmaltado común (60 min)',                             'Manicuría y Pedicuría|Esmalte común'),
    ('Pedicuría con esmaltado común',                                             'Manicuría y Pedicuría|Esmalte común'),
    ('Pedicuría con esmaltado común',                                             'Manicuría y Pedicuría|Pedicuría'),
    ('Pedicuría sin esmalte',                                                     'Manicuría y Pedicuría|Pedicuría'),
    ('Belleza de pies con kapping (diseño liso)',                                 'Manicuría y Pedicuría|Pedicuría'),
    ('Belleza de pies con kapping (diseño liso)',                                 'Manicuría y Pedicuría|Kapping'),
    ('Belleza de pies con semipermanente (diseño liso)',                          'Manicuría y Pedicuría|Pedicuría'),
    ('Belleza de pies con semipermanente (diseño liso)',                          'Manicuría y Pedicuría|Esmaltado con Semi Permanente'),
    ('Kapping en manos (diseño liso)',                                            'Manicuría y Pedicuría|Kapping'),
    ('Esculpidas Soft Gel en manos (diseño liso)',                                'Manicuría y Pedicuría|Esculpidas'),
    ('Reparación de uña con soft gel (extra)',                                    'Manicuría y Pedicuría|Esculpidas'),
    ('Retiro de esculpidas realizado en otro espacio (extra)',                    'Manicuría y Pedicuría|Esculpidas'),
    ('Retiro de esculpidas sin esmaltado',                                        'Manicuría y Pedicuría|Esculpidas'),
    ('Esmaltado semipermanente en manos (diseño liso)',                           'Manicuría y Pedicuría|Esmaltado con Semi Permanente'),
    ('Retiro de esmalte semi de manos y pies realizado en otro espacio (extra)',  'Manicuría y Pedicuría|Esmaltado con Semi Permanente'),
    ('Retiro de esmalte semi realizado en otro espacio (extra)',                  'Manicuría y Pedicuría|Esmaltado con Semi Permanente'),
    ('Retiro de esmalte semipermanente sin esmaltado',                            'Manicuría y Pedicuría|Esmaltado con Semi Permanente'),

    -- Masajes. "Masaje reductor" no está: queda colgado de Masajes, como pidió
    -- Pia, porque ninguna de las cuatro subcategorías lo cubre.
    ('Masaje cervico craneo facial hombre',                 'Masajes|Masajes Relajantes'),
    ('Masaje cervico craneo facial mujer',                  'Masajes|Masajes Relajantes'),
    ('Masaje cuerpo completo hombre',                       'Masajes|Masajes Relajantes'),
    ('Masaje cuerpo completo mujer',                        'Masajes|Masajes Relajantes'),
    ('Masaje espalda hombre',                               'Masajes|Masajes Descontracturantes'),
    ('Masaje espalda mujer',                                'Masajes|Masajes Descontracturantes'),
    ('Masaje drenaje linfático manual',                     'Masajes|Masajes Drenaje Linfático'),
    ('Drenaje linfático post quirúrgico con ultrasonido',   'Masajes|Masajes Drenaje Linfático'),

    -- Tratamientos Faciales
    ('Consulta de Cosmetología',                     'Tratamientos Faciales|Tratamientos Cosmetológicos'),
    ('Limpieza de Cutis con Dermaplaning',           'Tratamientos Faciales|Tratamientos Cosmetológicos|Dermaplaning'),
    ('Limpieza de Cutis con Peeling Cosmetológico',  'Tratamientos Faciales|Tratamientos Cosmetológicos|Peeling'),
    ('Tratamiento de Acné Juvenil - 4 Sesiones',     'Tratamientos Faciales|Acné y marcas de acné'),
    ('Tratamiento de Rosácea - 4 Sesiones',          'Tratamientos Faciales|Rosácea'),

    -- Aparatología
    ('Limpieza de Cutis con Dermapen (Microneedling)',                              'Aparatología|Aparatología Cosmetológica|Dermapen Cosmetológico'),
    ('HIFU Cuello y Escote o Contorno Ocular - Sesión',                             'Aparatología|Aparatología Cosmetológica|HIFU 12D'),
    ('HIFU Facial con Papada - Sesión',                                             'Aparatología|Aparatología Cosmetológica|HIFU 12D'),
    ('HIFU Facial con Papada, Cuello y Escote - Sesión',                            'Aparatología|Aparatología Cosmetológica|HIFU 12D'),
    ('Radiofrecuencia Fraccionada - Cuello y Escote o Contorno Ocular - Sesión',    'Aparatología|Aparatología Cosmetológica|Radiofrecuencia Fraccionada'),
    ('Radiofrecuencia Fraccionada Facial con Papada - Sesión',                      'Aparatología|Aparatología Cosmetológica|Radiofrecuencia Fraccionada'),
    ('Radiofrecuencia Fraccionada Facial con Papada, Cuello y Escote - Sesión',     'Aparatología|Aparatología Cosmetológica|Radiofrecuencia Fraccionada'),
    ('IPL Rostro - Sesión',                                                         'Aparatología|Aparatología Cosmetológica|Luz Pulsada IPL - Fotorejuvenecimiento'),
    ('IPL Rostro, Cuello y Escote - Sesión',                                        'Aparatología|Aparatología Cosmetológica|Luz Pulsada IPL - Fotorejuvenecimiento'),
    ('IPL Rostro, Cuello, Escote y Manos - Sesión',                                 'Aparatología|Aparatología Cosmetológica|Luz Pulsada IPL - Fotorejuvenecimiento'),
    ('Radiofrecuencia Facial - Rostro y Papada',                                    'Aparatología|Aparatología Cosmetológica|Radiofrecuencia Facial'),
    ('Radiofrecuencia Facial - Rostro, Cuello y Escote',                            'Aparatología|Aparatología Cosmetológica|Radiofrecuencia Facial'),
    ('Limpieza con Crio-Radiofrecuencia - Rostro y Papada',                         'Aparatología|Crio-Radiofrecuencia'),
    ('Limpieza con Crio-Radiofrecuencia - Rostro, Cuello y Escote',                 'Aparatología|Crio-Radiofrecuencia'),
    ('Radiofrecuencia Fraccionada Corporal',                                        'Aparatología|Radiofrecuencia Corporal'),

    -- Tratamientos Médicos
    ('DERMATOLOGIA - Consulta',                'Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica'),
    ('PRIMERA VEZ - Consulta por Tratamiento', 'Tratamientos Médicos|Dermatología|Dermatología Clínica|Consulta Dermatológica'),

    ('Baby Botox',                              'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Botox'),
    ('Botox Tercio Superior (50 unidades)',     'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Botox'),
    ('Exosomas y Factores de Crecimiento - Sesión', 'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores'),
    ('PDRN+ - Sesión por Zona',                 'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores'),
    ('Skin Booster Microneedling - Sesión',     'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores'),
    ('Skin Booster Intradérmico - Sesión',      'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores'),
    ('Profhilo - Sesión',                       'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores|Profhilo'),
    ('Profhilo Structura - Sesión',             'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores|Profhilo'),
    ('Radiesse Facial (por jeringa)',           'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Arrugas y Flaccidez|Bioestimuladores|Radiesse'),
    ('Sunekos - Tratamiento de Ojeras',         'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Contorno de ojos y párpados|Sunekos'),
    ('Blefaroplastia No Quirúrgica - Párpado Superior o Inferior', 'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Contorno de ojos y párpados'),
    ('Blefaroplastia No Quirúrgica - Párpado Superior y Inferior', 'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Contorno de ojos y párpados'),
    ('Relleno de Labios con Ácido Hialurónico', 'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Armonización de Labios|Relleno con Ácido Hialurónico'),
    ('Hialuronidasa',                           'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Armonización de Labios|Hialuronidasa'),
    ('Botox para Bruxismo',                     'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Bruxismo'),
    ('Botox - Sonrisa Gingival',                'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Armonización Facial'),
    ('Peeling Médico',                          'Tratamientos Médicos|Dermatología|Dermatología Estética|Facial|Manchas (dermatología)'),

    ('Botox para Hiperhidrosis',                            'Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Hiperhidrosis'),
    ('Mesoterapia Lipolítica - Lipolytic (Mesoestetic)',    'Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Tratamientos Reductores'),
    ('Mesoterapia Body Firming (Mesoestetic)',              'Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Tratamientos Reductores'),
    ('Mesoterapia de Glúteos (Mesoestetic)',                'Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Tratamientos Reductores'),
    ('Mesoterapia Anticelulítica - Cellullishock (Mesoestetic)', 'Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Celulitis (dermatología)'),
    ('Alidya - Mesoterapia Anticelulítica, 1 Zona',         'Tratamientos Médicos|Dermatología|Dermatología Estética|Corporal|Celulitis (dermatología)'),

    ('PRP Corporal',                    'Tratamientos Médicos|Dermatología|Medicina Regenerativa|Infiltración de Plasma Rico en Plaquetas (PRP)'),
    ('PRP Corporal con Dermapen',       'Tratamientos Médicos|Dermatología|Medicina Regenerativa|Infiltración de Plasma Rico en Plaquetas (PRP)'),
    ('Regenera Joint - PRP Articular',  'Tratamientos Médicos|Dermatología|Medicina Regenerativa|Infiltración de Plasma Rico en Plaquetas (PRP)'),

    ('Biopsia con Extracción y Estudio Patológico', 'Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Biopsias cutáneas con estudio patológico'),
    ('Dermatoscopia - Control de Lunares',          'Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Control y cirugía de lesiones sospechosas|Extracción y control de lunares'),
    ('Electrocoagulación / Extracción de Verrugas', 'Tratamientos Médicos|Dermatología|Cirugía Dermatológica|Extracción de lesiones benignas|Verrugas vulgares y acrocordones'),
    ('Topicación',                                  'Tratamientos Médicos|Dermatología|Cirugía Dermatológica')
  ) AS v(servicio, ruta)
LOOP
  v_id := (mapa ->> r.ruta)::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'La ruta "%" no está en el árbol', r.ruta;
  END IF;

  -- Si un nombre de servicio no matchea nada es un typo de esta lista, no un
  -- dato faltante: se cuenta y se avisa al final en vez de fallar en silencio.
  IF NOT EXISTS (SELECT 1 FROM service WHERE name = r.servicio) THEN
    n_faltantes := n_faltantes + 1;
    RAISE WARNING 'Sin servicio llamado "%"', r.servicio;
    CONTINUE;
  END IF;

  INSERT INTO service_category (service_id, category_id, created_at)
  SELECT s.id, v_id, now()
    FROM service s
   WHERE s.name = r.servicio
     AND NOT EXISTS (SELECT 1 FROM service_category sc
                      WHERE sc.service_id = s.id AND sc.category_id = v_id);
  GET DIAGNOSTICS n_filas = ROW_COUNT;
  n_vinculos := n_vinculos + n_filas;
END LOOP;

-- ── F · Archivar las cinco que quedaron sin rol ────────────────────────────
-- Archivar NO borra el vínculo: los servicios conservan la categoría vieja,
-- invisible. Si hay que volver atrás, se desarchiva y aparece de nuevo.

UPDATE categories SET is_active = false, updated_at = now()
 WHERE is_active
   AND (
     -- su rol lo toma Aparatología Cosmetológica
     name = 'Aparatología Facial'
     -- se partió en Peeling + Dermaplaning
     OR name = 'Peeling y Dermaplaning'
     -- se partió en Acné y marcas de acné + Rosácea
     OR name = 'Tratamientos Faciales por Sesiones'
     -- las dos hijas vacías de la vieja Cosmetología
     OR (name IN ('Facial', 'Corporal') AND parent_category_id = v_cosmeto)
   );

-- ── G · Los vínculos a los ejes muertos de la 1.26.0 ───────────────────────
-- `Estética(Eje)` cuelga de 109 de los 123 servicios y `General(Eje)` de 9.
-- Están archivadas: no se ven en ningún lado, pero ensucian cada ficha. Se
-- borra el VÍNCULO, no la categoría ni el servicio.

DELETE FROM service_category
 WHERE category_id IN (SELECT id FROM categories WHERE name IN ('Estética(Eje)', 'General(Eje)'));

-- ── H · Los tres servicios duplicados en mayúsculas ────────────────────────
-- Verificado contra producción el 2026-09-04: los tres tienen 0 facturas
-- (`line_items`) y 0 turnos (`appointments`). Los dos de crio-radiofrecuencia
-- duplican servicios ya cargados con el nombre bien escrito; el de luz pulsada
-- no duplica a ninguno, y Pia confirmó igual el borrado el 2026-09-04.
--
-- El orden importa: `service` tiene 7 FK apuntándole sin ON DELETE CASCADE.
-- `service_embeddings` sí cascadea, así que no hace falta tocarla.

SELECT array_agg(s.id) INTO v_borrar
  FROM service s
 WHERE s.name IN ('LIMPIEZA CON CRIORADIOFRECUENCIA FACIAL',
                  'LIMPIEZA CON CRIORADIOFRECUENCIA - FACIAL + CUELLO Y ESCOTE',
                  'LUZ PULSADA INTENSA - En MANOS // AXILAS')
   AND NOT EXISTS (SELECT 1 FROM line_items li  WHERE li.service_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.service_id  = s.id);

IF v_borrar IS NOT NULL THEN
  DELETE FROM service_category         WHERE service_id = ANY(v_borrar);
  DELETE FROM service_machine          WHERE service_id = ANY(v_borrar);
  DELETE FROM service_provider_service WHERE service_id = ANY(v_borrar);
  DELETE FROM combo_service            WHERE service_id = ANY(v_borrar);
  DELETE FROM promotion_service        WHERE service_id = ANY(v_borrar);
  DELETE FROM service                  WHERE id         = ANY(v_borrar);
END IF;

-- ── I · Qué pasó ───────────────────────────────────────────────────────────
RAISE NOTICE 'creadas: % · mudanzas: % · reordenadas: % · vínculos nuevos: % · servicios borrados: % · nombres sin match: %',
             n_creadas, n_movidas, n_ordenadas, n_vinculos, coalesce(array_length(v_borrar, 1), 0), n_faltantes;

IF n_faltantes > 0 THEN
  RAISE EXCEPTION 'Hay % servicios de la lista que no existen en la base. Revisá los WARNING de arriba: son typos de la migración, no datos faltantes.', n_faltantes;
END IF;

END $mig$;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — correr aparte, después de aplicar
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1) Ningún servicio activo se quedó sin categoría. Tiene que dar 0.
--
-- SELECT count(*) AS sin_categoria
--   FROM service s
--  WHERE s.is_active
--    AND NOT EXISTS (SELECT 1 FROM service_category sc
--                      JOIN categories c ON c.id = sc.category_id AND c.is_active
--                     WHERE sc.service_id = s.id);
--
-- 2) El árbol nuevo, con cuántos servicios activos cuelgan de cada nodo.
--
-- WITH RECURSIVE t AS (
--   SELECT id, name, 1 AS nivel, name::text AS ruta
--     FROM categories WHERE parent_category_id IS NULL AND is_active AND kind <> 'area'
--   UNION ALL
--   SELECT c.id, c.name, t.nivel + 1, t.ruta || ' > ' || c.name
--     FROM categories c JOIN t ON c.parent_category_id = t.id WHERE c.is_active
-- )
-- SELECT repeat('  ', nivel - 1) || name AS arbol, nivel,
--        (SELECT count(*) FROM service_category sc JOIN service s
--           ON s.id = sc.service_id AND s.is_active WHERE sc.category_id = t.id) AS servicios
--   FROM t ORDER BY ruta;
--
-- 3) Ninguna categoría con servicios quedó fuera del árbol activo.
--
-- SELECT c.name, count(*) AS servicios
--   FROM categories c
--   JOIN service_category sc ON sc.category_id = c.id
--   JOIN service s ON s.id = sc.service_id AND s.is_active
--  WHERE NOT c.is_active
--  GROUP BY c.name ORDER BY 2 DESC;
--
-- 4) 120 servicios activos (123 menos los 3 borrados).
--
-- SELECT count(*) FROM service WHERE is_active;
