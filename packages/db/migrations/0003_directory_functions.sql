-- Directory tables (staff_users, bridges) are not RLS-scoped because they are looked up before a tenant is known.
-- The app role gets no direct access to them; it calls these narrow SECURITY DEFINER functions instead.
ALTER TABLE bridges ADD COLUMN pair_expires_at timestamptz;
UPDATE bridges SET pair_expires_at = now() + interval '30 days' WHERE pair_code IS NOT NULL;

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
