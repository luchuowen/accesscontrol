-- Lango core schema v1. Money is integer KES. Every tenant table carries tenant_id and is RLS-protected.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant directory (no RLS: resolved by slug before tenant context exists).
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES partners(id),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bridge registry (no RLS: looked up by id, then authenticated by HMAC).
CREATE TABLE bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  secret text NOT NULL,
  adapter text NOT NULL DEFAULT 'axtraxng',
  pair_code text UNIQUE,
  last_seen_at timestamptz,
  version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  key text NOT NULL CHECK (key ~ '^[a-z0-9-]{1,30}$'),
  name text NOT NULL,
  reader_ids int[] NOT NULL DEFAULT '{}',
  UNIQUE (site_id, key)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('membership', 'day_pass', 'addon', 'bundle')),
  name text NOT NULL,
  price_kes int NOT NULL CHECK (price_kes > 0),
  duration_unit text NOT NULL CHECK (duration_unit IN ('day', 'month')),
  duration_count int NOT NULL CHECK (duration_count > 0),
  zone_keys text[] NOT NULL CHECK (cardinality(zone_keys) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_no int NOT NULL CHECK (member_no BETWEEN 1 AND 2147483647),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, member_no)
);

CREATE TABLE credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_id uuid NOT NULL REFERENCES members(id),
  kind text NOT NULL DEFAULT 'card' CHECK (kind IN ('card', 'tag', 'wristband')),
  site_code int NOT NULL DEFAULT 0,
  card_code bigint NOT NULL,
  card_type int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, site_code, card_code)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  provider_txn_id text NOT NULL,
  amount_kes int NOT NULL CHECK (amount_kes > 0),
  account_ref text,
  phone text,
  external_ref text,
  status text NOT NULL CHECK (status IN ('completed', 'unmatched', 'applied')),
  member_id uuid REFERENCES members(id),
  product_id uuid REFERENCES products(id),
  raw jsonb,
  paid_at timestamptz NOT NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_txn_id)
);

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_id uuid NOT NULL REFERENCES members(id),
  zone_key text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  source text NOT NULL CHECK (source IN ('payment', 'override', 'import')),
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entitlements_member ON entitlements (member_id, zone_key, ends_at);

CREATE SEQUENCE access_state_seq;
CREATE TABLE access_states (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  member_id uuid NOT NULL REFERENCES members(id),
  version int NOT NULL,
  doc jsonb NOT NULL,
  seq bigint NOT NULL DEFAULT nextval('access_state_seq'),
  applied_version int,
  applied_at timestamptz,
  error text,
  PRIMARY KEY (site_id, member_id)
);
CREATE INDEX access_states_seq ON access_states (site_id, seq);

CREATE TABLE access_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  axtrax_event_id bigint NOT NULL,
  at timestamptz NOT NULL,
  reader_id int NOT NULL,
  door_id int NOT NULL,
  member_no int,
  card_code bigint NOT NULL,
  granted boolean NOT NULL,
  UNIQUE (site_id, axtrax_event_id)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor text NOT NULL,
  action text NOT NULL,
  entity text,
  data jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Row-level security: the app role sees only rows of app.tenant_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','zones','products','members','credentials','payments','entitlements','access_states','access_events','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                   WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
