-- Staff accounts (directory table: looked up by email at login, before tenant context exists).
CREATE TABLE staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),            -- null = partner-level user
  partner_id uuid REFERENCES partners(id),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('partner_admin', 'owner', 'manager', 'reception', 'accountant')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Payment requests we initiate (STK push / checkout link). external_id is sent to the provider.
CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_id uuid NOT NULL REFERENCES members(id),
  product_id uuid NOT NULL REFERENCES products(id),
  amount_kes int NOT NULL CHECK (amount_kes > 0),
  phone text NOT NULL,
  provider text NOT NULL,
  provider_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_id uuid REFERENCES members(id),
  phone text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_ref text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-tenant provider settings (TaifaPay merchant keys etc.). Secrets are stored encrypted by the app.
CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  data jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE payments ADD COLUMN channel text NOT NULL DEFAULT 'mpesa' CHECK (channel IN ('mpesa', 'card', 'cash', 'bank', 'test'));
ALTER TABLE payments ADD COLUMN recorded_by text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_intents','sms_messages','tenant_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                   WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
