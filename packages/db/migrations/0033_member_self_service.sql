-- Member self-service, phase 2 (5 Oct 2026): block a lost card, pause a membership, my details.

-- Lost card: the member blocks their own cards at once. Revoked cards leave the door state (and a bridge that
-- knows "revoked" switches them off in AxTraxNG); while the block stands, the member's door access is held
-- even on an older bridge. Linking a new card at reception lifts the block; the old card stays revoked.
ALTER TABLE credentials ADD COLUMN revoked_at timestamptz;
ALTER TABLE credentials ADD COLUMN revoked_reason text;
ALTER TABLE members ADD COLUMN cards_blocked_at timestamptz;

-- My details: an emergency contact the member keeps up to date.
ALTER TABLE members ADD COLUMN emergency_name text CHECK (length(emergency_name) <= 80);
ALTER TABLE members ADD COLUMN emergency_phone text CHECK (length(emergency_phone) <= 20);

-- Pause: access stops for the window and the lost days are added after the plan's end (entitlements with
-- source 'pause', source_id = the pause), so the change is recorded, never a silent edit.
ALTER TABLE entitlements DROP CONSTRAINT entitlements_source_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_source_check
  CHECK (source IN ('payment', 'override', 'import', 'pause'));

CREATE TABLE member_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  reason text NOT NULL CHECK (length(reason) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'on' CHECK (status IN ('on', 'cancelled')),
  created_by text NOT NULL,
  ended_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_pauses_member ON member_pauses (member_id, status, starts_at);
ALTER TABLE member_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_pauses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_pauses
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Codes sent to confirm a new phone number live beside sign-in codes, kept apart by purpose.
ALTER TABLE member_otps ADD COLUMN purpose text NOT NULL DEFAULT 'signin' CHECK (purpose IN ('signin', 'phone'));
