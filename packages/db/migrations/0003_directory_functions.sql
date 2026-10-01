-- Directory tables (staff_users, bridges) are not RLS-scoped because they are looked up before a tenant is known.
-- The app role gets no direct access to them; it calls these narrow SECURITY DEFINER functions instead.
ALTER TABLE bridges ADD COLUMN pair_expires_at timestamptz;
-- Unused pairing codes move to the new format (XXXXX-XXXXX, no look-alike characters) with a 30-day expiry.
UPDATE bridges b SET pair_expires_at = now() + interval '30 days', pair_code = (
  SELECT substr(c, 1, 5) || '-' || substr(c, 6) FROM (
    SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + get_byte(gen_random_bytes(1), 0) % 30, 1), '' ORDER BY g) AS c
    FROM generate_series(1, 10) g WHERE b.id IS NOT NULL) x)
WHERE pair_code IS NOT NULL;

CREATE FUNCTION app_bridge_auth(p_id uuid)
RETURNS TABLE (id uuid, tenant_id uuid, site_id uuid, secret text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.tenant_id, b.site_id, b.secret FROM bridges b WHERE b.id = p_id
$$;

CREATE FUNCTION app_bridge_touch(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE bridges SET last_seen_at = now() WHERE id = p_id
$$;

-- One-time pairing: valid unexpired code → store the freshly generated secret, burn the code.
CREATE FUNCTION app_bridge_pair(p_code text, p_secret text, p_version text)
RETURNS TABLE (id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE bridges SET pair_code = NULL, pair_expires_at = NULL, secret = p_secret, version = p_version, last_seen_at = now()
  WHERE pair_code = p_code AND (pair_expires_at IS NULL OR pair_expires_at > now())
  RETURNING bridges.id
$$;

-- Bridges of the current tenant only (reads app.tenant_id, so it cannot be pointed at another tenant).
CREATE FUNCTION app_tenant_bridges()
RETURNS TABLE (id uuid, site_id uuid, pair_code text, last_seen_at timestamptz, adapter text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.site_id, b.pair_code, b.last_seen_at, b.adapter FROM bridges b
  WHERE b.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app_staff_login(p_email text)
RETURNS TABLE (id uuid, tenant_id uuid, name text, role text, password_hash text, active boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.tenant_id, s.name, s.role, s.password_hash, s.active FROM staff_users s WHERE s.email = lower(p_email)
$$;

CREATE FUNCTION app_staff_active(p_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT active FROM staff_users WHERE id = p_id), false)
$$;

-- Functions are executable by PUBLIC by default; only the app role may call these.
REVOKE EXECUTE ON FUNCTION app_bridge_auth(uuid), app_bridge_touch(uuid), app_bridge_pair(text, text, text),
  app_tenant_bridges(), app_staff_login(text), app_staff_active(uuid) FROM PUBLIC;
