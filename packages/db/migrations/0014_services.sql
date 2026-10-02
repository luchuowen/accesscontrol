-- Services (Owen, 2 Oct 2026). A club sells SERVICES it names itself (Swimming, Sauna, Gym, Squash…). Each service
-- opens one or more AREAS (zones: sets of doors) and has one or more PRICES, each with its own length in hours, days,
-- weeks, months or years. Prices may repeat across services: nothing is identified by amount alone any more.
-- What a person bought is copied onto the sale line, so editing or retiring a service never touches anyone who has
-- already paid (no lockouts, no rewritten history).

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  zone_keys text[] NOT NULL CHECK (cardinality(zone_keys) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A product is now one PRICE of a service ("Swimming · 2 hours", KES 300). zone_keys mirror the service's areas.
ALTER TABLE products ADD COLUMN service_id uuid REFERENCES services(id);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_duration_unit_check;
ALTER TABLE products ADD CONSTRAINT products_duration_unit_check
  CHECK (duration_unit IN ('hour', 'day', 'week', 'month', 'year'));
ALTER TABLE products ALTER COLUMN kind SET DEFAULT 'membership';

-- Existing plans become services: plans opening the same areas form one service, named after their shared prefix
-- ("Gym · 1 month" + "Gym · day pass" → "Gym").
DO $$
DECLARE g record; v_id uuid; v_name text;
BEGIN
  FOR g IN
    SELECT tenant_id, (SELECT array_agg(z ORDER BY z) FROM unnest(zone_keys) z) AS zk,
           array_agg(name ORDER BY created_at) AS names, bool_or(active) AS any_active
    FROM products GROUP BY tenant_id, (SELECT array_agg(z ORDER BY z) FROM unnest(zone_keys) z)
  LOOP
    v_name := split_part(g.names[1], ' · ', 1);
    IF v_name = '' OR EXISTS (SELECT 1 FROM unnest(g.names) n WHERE split_part(n, ' · ', 1) <> v_name) THEN
      v_name := (SELECT string_agg(coalesce(z.name, k), ' + ') FROM unnest(g.zk) k
                 LEFT JOIN LATERAL (SELECT name FROM zones WHERE zones.tenant_id = g.tenant_id AND zones.key = k LIMIT 1) z ON true);
    END IF;
    INSERT INTO services (tenant_id, name, zone_keys, active) VALUES (g.tenant_id, left(v_name, 60), g.zk, g.any_active)
      RETURNING id INTO v_id;
    UPDATE products SET service_id = v_id
      WHERE tenant_id = g.tenant_id AND (SELECT array_agg(z ORDER BY z) FROM unnest(zone_keys) z) = g.zk;
  END LOOP;
END $$;

-- Which service (and price) an entitlement came from: renewals stack per service, not per door area.
ALTER TABLE entitlements ADD COLUMN service_id uuid REFERENCES services(id);
ALTER TABLE entitlements ADD COLUMN product_id uuid REFERENCES products(id);
UPDATE entitlements e SET product_id = p.product_id, service_id = pr.service_id
  FROM payments p JOIN products pr ON pr.id = p.product_id
  WHERE e.source = 'payment' AND e.source_id = p.id;
CREATE INDEX entitlements_member_service ON entitlements (member_id, service_id, ends_at);

-- One payment can pay for several services at once (Swimming 500 + Sauna 350 = 850). Each line keeps a copy of
-- what was sold, as it was at the time.
CREATE TABLE payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  product_id uuid REFERENCES products(id),
  service_id uuid REFERENCES services(id),
  label text NOT NULL,
  zone_keys text[] NOT NULL,
  price_kes int NOT NULL CHECK (price_kes > 0),
  duration_unit text NOT NULL,
  duration_count int NOT NULL CHECK (duration_count > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_lines_payment ON payment_lines (payment_id);
INSERT INTO payment_lines (tenant_id, payment_id, product_id, service_id, label, zone_keys, price_kes, duration_unit, duration_count, created_at)
  SELECT p.tenant_id, p.id, pr.id, pr.service_id, pr.name, pr.zone_keys, p.amount_kes, pr.duration_unit, pr.duration_count, coalesce(p.applied_at, p.created_at)
  FROM payments p JOIN products pr ON pr.id = p.product_id WHERE p.status = 'applied';

-- An M-Pesa prompt can carry several prices: [{ "productId": "…", "priceKes": 500 }, …]. The amount is their sum.
ALTER TABLE payment_intents ADD COLUMN lines jsonb;
ALTER TABLE payment_intents ALTER COLUMN product_id DROP NOT NULL;

-- Walk-ins: a visitor buys one or more passes and gets a reusable wristband (a member in the 11001–11999 pool).
-- One row per visit: who, which band, what they paid; the band only opens once the payment is confirmed.
CREATE TABLE day_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  band_id uuid NOT NULL REFERENCES members(id),
  visitor_name text NOT NULL CHECK (length(visitor_name) BETWEEN 1 AND 80),
  visitor_phone text,
  lines jsonb NOT NULL,
  total_kes int NOT NULL CHECK (total_kes > 0),
  channel text NOT NULL CHECK (channel IN ('mpesa', 'cash')),
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment', 'active', 'failed', 'cancelled')),
  intent_id uuid REFERENCES payment_intents(id),
  payment_id uuid REFERENCES payments(id),
  ends_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX day_passes_tenant_created ON day_passes (tenant_id, created_at);
CREATE INDEX day_passes_phone ON day_passes (tenant_id, visitor_phone);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['services','payment_lines','day_passes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                   WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
