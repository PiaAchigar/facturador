-- ════════════════════════════════════════════════════════════════════════════
-- 1.38.0 / 00 — Red antes de tocar el árbol
-- ════════════════════════════════════════════════════════════════════════════
-- Mismo criterio que la 1.26.0/00 (`service_category_backup_1260`): copia
-- completa de lo que la 01 va a modificar, ANTES de modificarlo.
--
-- La 01 hace dos cosas que no se deshacen solas:
--   · borra 118 vínculos a Estética(Eje)/General(Eje)
--   · borra 3 servicios duplicados y todas sus filas hijas
-- Todo lo demás (crear, mover, renombrar, archivar) es reversible mirando estas
-- dos tablas.
--
-- Idempotente: `IF NOT EXISTS` no pisa una copia ya tomada. Eso importa — si se
-- corriera dos veces DESPUÉS de la 01, la segunda copiaría el estado nuevo y se
-- perdería el original.

CREATE TABLE IF NOT EXISTS service_category_backup_1380 AS
  SELECT sc.*, now() AS copiado_el FROM service_category sc;

CREATE TABLE IF NOT EXISTS categories_backup_1380 AS
  SELECT c.*, now() AS copiado_el FROM categories c;

CREATE TABLE IF NOT EXISTS service_backup_1380 AS
  SELECT s.*, now() AS copiado_el FROM service s;
