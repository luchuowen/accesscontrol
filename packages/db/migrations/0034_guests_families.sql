-- Member self-service, phase 3 (5 Oct 2026): guest passes and paying for family members in one bill.

-- Guest pass: a member pays for a friend's day pass. The friend gets a 6-digit code by SMS; at reception staff type
-- the code and hand over a day wristband from the pool, which opens the paid areas until 23:59 that day.
CREATE TABLE guest_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  guest_name text NOT NULL CHECK (length(guest_name) BETWEEN 1 AND 80),
  guest_phone text NOT NULL,
  visit_date date NOT NULL,
  lines jsonb NOT NULL,
  total_kes int NOT NULL CHECK (total_kes > 0),
  code text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  status text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment', 'paid', 'used', 'failed')),
  intent_id uuid REFERENCES payment_intents(id),
  payment_id uuid REFERENCES payments(id),
  day_pass_id uuid REFERENCES day_passes(id),
  used_at timestamptz,
  used_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX guest_passes_host ON guest_passes (host_id, created_at);
CREATE INDEX guest_passes_phone ON guest_passes (tenant_id, guest_phone);
ALTER TABLE guest_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_passes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guest_passes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- A payment intent can be for a guest pass (settles the pass, opens nothing for the host).
ALTER TABLE payment_intents ADD COLUMN guest_pass_id uuid REFERENCES guest_passes(id);
