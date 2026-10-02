-- Onboarding: what the club's AxTraxNG already contains (sent by the Site Bridge), and partner-level views.

-- Snapshot of the site's AxTraxNG: readers/doors, access groups and users with their cards (no biometrics).
CREATE TABLE site_inventory (
  site_id uuid PRIMARY KEY REFERENCES sites(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE site_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_inventory FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_inventory
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Staff of a partner (installer such as John) or of the platform (partner_id null) may log in without a club.
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_scope;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_scope
  CHECK (role = 'partner_admin' OR tenant_id IS NOT NULL);

-- Clubs a partner admin may see: their partner's clubs, or every club for platform admins (partner_id null).
CREATE FUNCTION app_partner_clubs(p_staff uuid)
RETURNS TABLE (id uuid, slug text, name text, partner text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name, p.name, t.created_at
  FROM staff_users s JOIN tenants t ON (s.partner_id IS NULL OR t.partner_id = s.partner_id)
  LEFT JOIN partners p ON p.id = t.partner_id
  WHERE s.id = p_staff AND s.role = 'partner_admin' AND s.active
  ORDER BY t.name
$$;

-- Per-club figures for the partner dashboard (last 30 days). Only for clubs app_partner_clubs allows.
CREATE FUNCTION app_partner_stats(p_staff uuid)
RETURNS TABLE (
  tenant_id uuid, members int, active_members int, via_taifapay bigint, cash bigint, unmatched int,
  bridge_seen timestamptz, taifapay_env text, paybill text, till text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id,
    (SELECT count(*)::int FROM members m WHERE m.tenant_id = c.id AND m.status = 'active'),
    (SELECT count(DISTINCT e.member_id)::int FROM entitlements e WHERE e.tenant_id = c.id AND now() BETWEEN e.starts_at AND e.ends_at),
    (SELECT coalesce(sum(amount_kes), 0) FROM payments p WHERE p.tenant_id = c.id AND p.status = 'applied'
       AND p.channel <> 'cash' AND p.provider <> 'seed' AND p.paid_at > now() - interval '30 days'),
    (SELECT coalesce(sum(amount_kes), 0) FROM payments p WHERE p.tenant_id = c.id AND p.status = 'applied'
       AND p.channel = 'cash' AND p.paid_at > now() - interval '30 days'),
    (SELECT count(*)::int FROM payments p WHERE p.tenant_id = c.id AND p.status = 'unmatched'),
    (SELECT max(b.last_seen_at) FROM bridges b WHERE b.tenant_id = c.id),
    (SELECT ts.data->'taifapay'->>'env' FROM tenant_settings ts WHERE ts.tenant_id = c.id),
    (SELECT ts.data->'channels'->>'paybill' FROM tenant_settings ts WHERE ts.tenant_id = c.id),
    (SELECT ts.data->'channels'->>'till' FROM tenant_settings ts WHERE ts.tenant_id = c.id)
  FROM app_partner_clubs(p_staff) c
$$;

-- Create a club in one step: tenant, first site, Site Bridge pairing code, owner account, empty settings.
CREATE FUNCTION app_create_club(
  p_staff uuid, p_slug text, p_name text, p_timezone text,
  p_owner_email text, p_owner_name text, p_owner_hash text, p_pair_code text, p_bridge_secret text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid; v_tenant uuid; v_site uuid; v_ok boolean;
BEGIN
  SELECT true, s.partner_id INTO v_ok, v_partner FROM staff_users s
   WHERE s.id = p_staff AND s.role = 'partner_admin' AND s.active;
  IF v_ok IS NULL THEN RAISE EXCEPTION 'not a partner admin'; END IF;
  INSERT INTO tenants (partner_id, slug, name, timezone) VALUES (v_partner, p_slug, p_name, p_timezone) RETURNING id INTO v_tenant;
  INSERT INTO sites (tenant_id, name) VALUES (v_tenant, 'Main site') RETURNING id INTO v_site;
  INSERT INTO bridges (tenant_id, site_id, secret, pair_code, pair_expires_at)
    VALUES (v_tenant, v_site, p_bridge_secret, p_pair_code, now() + interval '30 days');
  INSERT INTO staff_users (tenant_id, partner_id, email, name, role, password_hash)
    VALUES (v_tenant, v_partner, lower(p_owner_email), p_owner_name, 'owner', p_owner_hash);
  INSERT INTO tenant_settings (tenant_id, data) VALUES (v_tenant, '{}');
  INSERT INTO audit_log (tenant_id, actor, action, entity, data)
    VALUES (v_tenant, p_staff::text, 'club.created', v_tenant::text, jsonb_build_object('slug', p_slug, 'owner', lower(p_owner_email)));
  RETURN v_tenant;
END $$;

-- A new pairing code for a club's (first) Site Bridge, e.g. when the installer reinstalls the PC.
CREATE FUNCTION app_reissue_pair_code(p_code text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE bridges SET pair_code = p_code, pair_expires_at = now() + interval '30 days'
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

REVOKE EXECUTE ON FUNCTION app_partner_clubs(uuid), app_partner_stats(uuid),
  app_create_club(uuid, text, text, text, text, text, text, text, text), app_reissue_pair_code(text) FROM PUBLIC;
