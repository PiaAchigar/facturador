-- ════════════════════════════════════════════════════════════════════════════
-- 1.45.0 / 01 — V1 de venta y consumo: lo que la clienta compra
-- ════════════════════════════════════════════════════════════════════════════
-- UNA SOLA SENTENCIA. El SQL Editor de Supabase hace autocommit por sentencia:
-- si esto fueran varias, un error en el medio dejaría la base a medio armar
-- (pasó de verdad con la 1.34.0). Por eso va todo en un único bloque DO, sin
-- `CREATE TEMP TABLE ... ON COMMIT DROP` y sin `\echo`.
--
-- Spec: docs/superpowers/specs/2026-08-26-venta-y-consumo-de-packs-design.md §4
--
-- LA IDEA
-- Hay dos formas de vender y se distinguen por UNA pregunta: ¿queda algo
-- pendiente cuando la clienta se va? (decisión de Pia, 2026-09-08)
--   · No queda nada  → checkout de mostrador, que ya existe.
--   · Queda plata o sesiones → COMPRA, que es lo que crea esta migración.
--
-- COMBO y PACK son dos EJES, no dos tipos:
--   · COMBO responde "¿qué entra en UNA sesión?" (fijo o a elección)
--   · PACK  responde "¿cuántas veces se repite?" (customer_purchase.sessions_total)
-- Por eso el combo vive en `combos` y la repetición en la compra: cruzarlos da
-- las tres formas que usa Laura sin modelar nada más.
--
-- ⚠️ `combo_service.sessions_included` NO es la repetición entre visitas. Es
-- cuántas veces se aplica ese servicio DENTRO de una misma sesión (dos zonas
-- del mismo aparato en la misma visita). Multiplicarlo por `sessions_total`
-- cobraría de más: un combo con 2 vendido como pack de 4 daría 8.
--
-- Idempotente: CREATE TABLE / ADD COLUMN / CREATE INDEX con IF NOT EXISTS, y
-- los CHECK y FK se agregan sólo si no están.

DO $$
BEGIN
  -- ══ 1. El eje "a elección" de los combos ═══════════════════════════════════
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS choice_mode varchar(10) NOT NULL DEFAULT 'fijo';
  ALTER TABLE combos ADD COLUMN IF NOT EXISTS choice_budget_minutes integer;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_combos_eleccion') THEN
    -- Un combo a elección necesita presupuesto de minutos; uno fijo no puede
    -- tenerlo. Sin esto, "a elección sin presupuesto" dejaría armar una sesión
    -- infinita.
    --
    -- ⚠️ El `IS NOT NULL` no sobra. Un CHECK pasa cuando evalúa a NULL, y
    -- `NULL > 0` es NULL: escrito como está en el spec (§4.1), un combo a
    -- elección SIN presupuesto entraba igual. Verificado a mano contra la base
    -- el 2026-09-08 — entró, y por eso está esta línea.
    ALTER TABLE combos ADD CONSTRAINT ck_combos_eleccion CHECK (
      (choice_mode = 'fijo'     AND choice_budget_minutes IS NULL) OR
      (choice_mode = 'eleccion' AND choice_budget_minutes IS NOT NULL
                                AND choice_budget_minutes > 0)
    );
  END IF;

  -- false = el servicio SIEMPRE entra en la sesión.
  -- true  = está en el menú elegible y la clienta arma su hora con estos.
  -- Un combo puede tener las dos cosas: "masaje incluido + 40 min a elección".
  ALTER TABLE combo_service ADD COLUMN IF NOT EXISTS is_choice boolean NOT NULL DEFAULT false;

  -- ══ 2. Lo que la clienta compró ════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS customer_purchase (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         uuid NOT NULL REFERENCES customers(id),
    -- Exactamente UNO de los tres orígenes. Son FK reales y no un
    -- source_type/source_id porque el conjunto es chico y conocido, y así
    -- Postgres garantiza que apuntan a algo que existe.
    combo_id            uuid REFERENCES combos(id),
    service_id          uuid REFERENCES service(id),
    depilation_combo_id uuid REFERENCES depilation_combo(id),
    -- Qué se vendió, CONGELADO: si mañana Laura renombra el combo, la venta de
    -- agosto tiene que seguir diciendo qué se vendió. El FK sirve para trazar;
    -- el texto, para leer.
    description         varchar(200) NOT NULL,
    sessions_total      integer NOT NULL,
    -- Precio congelado al vender, en sus tres capas.
    base_amount         numeric(10,2) NOT NULL,  -- sin ningún descuento
    discounted_amount   numeric(10,2) NOT NULL,  -- capa 1: el pack/combo
    promotion_id        uuid REFERENCES promotions(id),
    final_amount        numeric(10,2) NOT NULL,  -- capa 2: después de la promo
    purchased_at        timestamp NOT NULL DEFAULT now(),
    expires_at          timestamp,
    cancelled_at        timestamp,
    notes               text,
    created_at          timestamp NOT NULL DEFAULT now(),
    updated_at          timestamp NOT NULL DEFAULT now(),
    CONSTRAINT ck_cpu_sesiones CHECK (sessions_total > 0),
    CONSTRAINT ck_cpu_montos CHECK (
      base_amount >= 0 AND discounted_amount >= 0 AND final_amount >= 0
    ),
    CONSTRAINT ck_cpu_origen_unico CHECK (
      (combo_id IS NOT NULL)::int
      + (service_id IS NOT NULL)::int
      + (depilation_combo_id IS NOT NULL)::int = 1
    )
  );

  -- NO hay `invoice_id`: una compra puede tener VARIAS facturas (regla 5.11 —
  -- Laura factura el primer pago ahora y el saldo después, o todo junto). El
  -- vínculo va por line_items.customer_purchase_id, que es 1:N.
  CREATE INDEX IF NOT EXISTS ix_cpu_customer ON customer_purchase (customer_id, purchased_at DESC);

  -- ══ 3. El consumo, sesión por sesión ═══════════════════════════════════════
  CREATE TABLE IF NOT EXISTS customer_purchase_session (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_purchase_id uuid NOT NULL REFERENCES customer_purchase(id) ON DELETE CASCADE,
    session_number       integer NOT NULL,
    appointment_id       uuid REFERENCES appointments(id),
    consumed_at          timestamp,
    notes                text,
    created_at           timestamp NOT NULL DEFAULT now(),
    updated_at           timestamp NOT NULL DEFAULT now(),
    CONSTRAINT ux_cps_numero UNIQUE (customer_purchase_id, session_number),
    -- Un turno no consume dos sesiones. La columna es nullable y está bien:
    -- Postgres permite N filas con NULL en un índice único, así que las
    -- sesiones sin agendar conviven, y en cuanto dos intentan colgarse del
    -- mismo turno la restricción salta. No hay que "arreglarlo" con un índice
    -- parcial.
    CONSTRAINT ux_cps_turno UNIQUE (appointment_id)
  );

  -- NO tiene columna de estado, y por eso no puede desincronizarse: se deriva
  -- de consumed_at / appointment_id / expires_at. Un turno cancelado devuelve
  -- la sesión a "disponible" sin que nadie escriba nada.

  -- ══ 4. Qué se eligió en cada sesión (sólo combos a elección) ═══════════════
  CREATE TABLE IF NOT EXISTS customer_purchase_session_service (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES customer_purchase_session(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES service(id),
    minutes    integer NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT ux_cpss UNIQUE (session_id, service_id),
    CONSTRAINT ck_cpss_minutos CHECK (minutes > 0)
  );

  -- ══ 5. A qué le aplica una promo ═══════════════════════════════════════════
  -- Hoy una promo sólo apunta a un servicio o a un producto. Faltaba poder
  -- apuntar a una zona de depilación, a un combo y a un pack.
  CREATE TABLE IF NOT EXISTS promotion_target (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id        uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    service_id          uuid REFERENCES service(id),
    body_zone_id        uuid REFERENCES body_zone(id),
    combo_id            uuid REFERENCES combos(id),
    depilation_combo_id uuid REFERENCES depilation_combo(id),
    created_at          timestamp NOT NULL DEFAULT now(),
    CONSTRAINT ck_pt_destino_unico CHECK (
      (service_id IS NOT NULL)::int
      + (body_zone_id IS NOT NULL)::int
      + (combo_id IS NOT NULL)::int
      + (depilation_combo_id IS NOT NULL)::int = 1
    ),
    -- ⚠️ `NULLS NOT DISTINCT` no sobra. Por default Postgres considera que dos
    -- NULL son distintos, así que un UNIQUE sobre columnas mayormente nulas no
    -- impide NADA: la misma promo podía apuntar dos veces al mismo combo.
    -- Verificado a mano contra la base el 2026-09-08 — entró duplicado, y por
    -- eso está esta cláusula. Requiere PG 15+; producción es 17.6 y local 15.4.
    CONSTRAINT ux_pt UNIQUE NULLS NOT DISTINCT
      (promotion_id, service_id, body_zone_id, combo_id, depilation_combo_id)
  );
  -- Combo y pack comparten columna a propósito: un pack de catálogo ES una
  -- fila de `combos` o de `depilation_combo`; la diferencia está en los datos
  -- de esa fila, no en a qué tabla pertenece.

  CREATE INDEX IF NOT EXISTS ix_pt_promotion ON promotion_target (promotion_id);

  -- ══ 6. Enganches con lo que ya existe ══════════════════════════════════════
  -- Con payments.customer_purchase_id el saldo tiene UNA sola definición:
  --   saldo = final_amount − Σ payments.amount (confirmed) de esa compra
  ALTER TABLE payments   ADD COLUMN IF NOT EXISTS customer_purchase_id uuid;
  ALTER TABLE line_items ADD COLUMN IF NOT EXISTS customer_purchase_id uuid;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_customer_purchase') THEN
    ALTER TABLE payments ADD CONSTRAINT fk_payments_customer_purchase
      FOREIGN KEY (customer_purchase_id) REFERENCES customer_purchase(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_line_items_customer_purchase') THEN
    ALTER TABLE line_items ADD CONSTRAINT fk_line_items_customer_purchase
      FOREIGN KEY (customer_purchase_id) REFERENCES customer_purchase(id);
  END IF;

  CREATE INDEX IF NOT EXISTS ix_payments_purchase ON payments (customer_purchase_id);
  CREATE INDEX IF NOT EXISTS ix_line_items_purchase ON line_items (customer_purchase_id);

  RAISE NOTICE 'V1 de venta y consumo lista: customer_purchase, sesiones, promotion_target';
END $$;

-- ── Verificación (correr aparte, no forma parte de la migración) ────────────
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('customer_purchase','customer_purchase_session',
--                       'customer_purchase_session_service','promotion_target');
