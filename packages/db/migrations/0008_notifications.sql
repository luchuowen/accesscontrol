-- Notifications: quiet hours / daily cap support, portal sign-in codes, member opt-out of club news,
-- bridge health across clubs (for alerts), and platform notes the app may record (Source Code balance, alert times).

-- A message that is no longer true after this moment is dropped instead of sent late (e.g. "ends today").
ALTER TABLE sms_messages ADD COLUMN send_before timestamptz;
CREATE INDEX sms_messages_member_sent ON sms_messages (member_id, sent_at) WHERE member_id IS NOT NULL;

-- Members can turn off club news and "we miss you" messages (receipts and reminders still come).
ALTER TABLE members ADD COLUMN sms_news boolean NOT NULL DEFAULT true;

-- One-time portal sign-in codes (only a hash is kept).
CREATE TABLE member_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_id uuid NOT NULL REFERENCES members(id),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_otps_member ON member_otps (member_id, created_at);
ALTER TABLE member_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_otps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_otps USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Bridges that have connected at least once, across clubs, for offline alerts (no secrets).
CREATE FUNCTION app_bridge_health()
RETURNS TABLE (bridge_id uuid, tenant_id uuid, club text, timezone text, site text, last_seen_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.tenant_id, t.name, t.timezone, s.name, b.last_seen_at
  FROM bridges b JOIN tenants t ON t.id = b.tenant_id JOIN sites s ON s.id = b.site_id
  WHERE b.last_seen_at IS NOT NULL
  ORDER BY t.name, s.name
$$;

-- The app records operational notes (never credentials): Source Code's last reported credit, last alert times.
CREATE FUNCTION app_platform_note(p_key text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_key NOT IN ('sms_status', 'ops_alerts') THEN RAISE EXCEPTION 'not a note key'; END IF;
  INSERT INTO platform_settings (key, data, updated_at) VALUES (p_key, p_data, now())
  ON CONFLICT (key) DO UPDATE SET data = platform_settings.data || excluded.data, updated_at = now();
END $$;

REVOKE EXECUTE ON FUNCTION app_bridge_health(), app_platform_note(text, jsonb) FROM PUBLIC;
