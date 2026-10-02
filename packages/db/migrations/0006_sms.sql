-- SMS delivery through the platform's Source Code account (sender ID per platform, on/off per club).
ALTER TABLE sms_messages ADD COLUMN attempts int NOT NULL DEFAULT 0;
ALTER TABLE sms_messages ADD COLUMN sent_at timestamptz;
ALTER TABLE sms_messages ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX sms_messages_dedupe ON sms_messages (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX sms_messages_queue ON sms_messages (tenant_id, status, created_at);
ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_status_check;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_status_check
  CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));
-- Nothing queued before SMS existed is ever sent (demo data, old receipts).
UPDATE sms_messages SET status = 'skipped', error = 'queued before SMS was connected' WHERE status = 'queued';

-- Platform-wide settings (e.g. the Source Code account). Not tenant data: no RLS, no direct app access.
CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE FUNCTION app_platform_get(p_key text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT data FROM platform_settings WHERE key = p_key
$$;

-- Only platform admins (partner_admin with no partner) may change platform settings.
CREATE FUNCTION app_platform_set(p_staff uuid, p_key text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_users s WHERE s.id = p_staff AND s.role = 'partner_admin'
                 AND s.partner_id IS NULL AND s.active) THEN
    RAISE EXCEPTION 'not a platform admin';
  END IF;
  INSERT INTO platform_settings (key, data, updated_at, updated_by) VALUES (p_key, p_data, now(), p_staff)
  ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_at = now(), updated_by = p_staff;
END $$;

CREATE FUNCTION app_is_platform(p_staff uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT s.role = 'partner_admin' AND s.partner_id IS NULL AND s.active FROM staff_users s WHERE s.id = p_staff), false)
$$;

REVOKE EXECUTE ON FUNCTION app_platform_get(text), app_platform_set(uuid, text, jsonb), app_is_platform(uuid) FROM PUBLIC;
