-- User management: roles and permissions, one login for several clubs, partner teams, and an audit of every
-- sign-in event. role_permissions is the single source of truth for what each role may do; the app reads it.

-- ---------- what each role may do ----------
CREATE TABLE role_permissions (
  role text NOT NULL,
  perm text NOT NULL,
  PRIMARY KEY (role, perm)
);
INSERT INTO role_permissions (role, perm)
SELECT r, p FROM (VALUES
  -- owner: everything
  ('owner', 'members.view'), ('owner', 'members.edit'), ('owner', 'payments.record'), ('owner', 'payments.assign'),
  ('owner', 'access.comp'), ('owner', 'plans.manage'), ('owner', 'doors.manage'), ('owner', 'messages.manage'),
  ('owner', 'sms.buy'), ('owner', 'reports.all'), ('owner', 'team.manage'), ('owner', 'billing.manage'),
  ('owner', 'settings.payments'), ('owner', 'club.own'),
  -- admin: everything except closing the club and handing over ownership
  ('admin', 'members.view'), ('admin', 'members.edit'), ('admin', 'payments.record'), ('admin', 'payments.assign'),
  ('admin', 'access.comp'), ('admin', 'plans.manage'), ('admin', 'doors.manage'), ('admin', 'messages.manage'),
  ('admin', 'sms.buy'), ('admin', 'reports.all'), ('admin', 'team.manage'), ('admin', 'billing.manage'),
  ('admin', 'settings.payments'),
  -- manager: runs the club day to day; no team, subscription or payment keys
  ('manager', 'members.view'), ('manager', 'members.edit'), ('manager', 'payments.record'),
  ('manager', 'payments.assign'), ('manager', 'access.comp'), ('manager', 'plans.manage'),
  ('manager', 'doors.manage'), ('manager', 'messages.manage'), ('manager', 'sms.buy'), ('manager', 'reports.all'),
  -- front desk: register members, take payments, link cards; reports for today only
  ('reception', 'members.view'), ('reception', 'members.edit'), ('reception', 'payments.record'),
  -- accountant: money and reports
  ('accountant', 'members.view'), ('accountant', 'payments.record'), ('accountant', 'payments.assign'),
  ('accountant', 'sms.buy'), ('accountant', 'reports.all'), ('accountant', 'billing.manage'),
  -- viewer: looks, changes nothing
  ('viewer', 'members.view'), ('viewer', 'reports.all'),
  -- partner technician working in an assigned club
  ('technician', 'members.view'), ('technician', 'members.edit'), ('technician', 'doors.manage')
) AS v(r, p);

-- ---------- club teams: one login, several clubs, a role per club ----------
CREATE TABLE club_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  staff_id uuid NOT NULL REFERENCES staff_users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'reception', 'accountant', 'viewer')),
  grants text[] NOT NULL DEFAULT '{}',   -- extra permissions for this one person
  denies text[] NOT NULL DEFAULT '{}',   -- permissions taken away from this one person
  invited_by uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES staff_users(id),
  PRIMARY KEY (tenant_id, staff_id)
);
-- Exactly one owner per club (the account holder for billing and the contract).
CREATE UNIQUE INDEX club_one_owner ON club_memberships (tenant_id) WHERE role = 'owner' AND removed_at IS NULL;
CREATE INDEX club_memberships_staff ON club_memberships (staff_id) WHERE removed_at IS NULL;

-- Today's club staff become memberships. A second "owner" in a club becomes an admin; switched-off staff are removed.
INSERT INTO club_memberships (tenant_id, staff_id, role, invited_by, created_at, removed_at)
SELECT s.tenant_id, s.id,
       CASE WHEN s.role = 'owner' AND row_number() OVER (PARTITION BY s.tenant_id, s.role ORDER BY s.created_at) > 1
            THEN 'admin' ELSE s.role END,
       s.invited_by, s.created_at,
       CASE WHEN s.active OR s.accepted_at IS NULL THEN NULL ELSE now() END
FROM staff_users s
WHERE s.role IN ('owner', 'manager', 'reception', 'accountant') AND s.tenant_id IS NOT NULL;

-- staff_users is now the person (login); their club roles live in club_memberships. tenant_id = last club used.
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_scope;
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_role_check;
UPDATE staff_users SET role = 'club' WHERE role IN ('owner', 'manager', 'reception', 'accountant');
UPDATE staff_users SET active = true WHERE role = 'club' AND accepted_at IS NOT NULL;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check
  CHECK (role IN ('club', 'partner_admin', 'partner_tech', 'navac_support'));
ALTER TABLE staff_users ADD CONSTRAINT staff_users_partner_scope
  CHECK (role <> 'partner_tech' OR partner_id IS NOT NULL);

-- ---------- partner technicians work only in the clubs assigned to them ----------
CREATE TABLE partner_assignments (
  staff_id uuid NOT NULL REFERENCES staff_users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, tenant_id)
);

-- ---------- audit of every sign-in event ----------
CREATE TABLE auth_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  staff_id uuid REFERENCES staff_users(id),
  tenant_id uuid REFERENCES tenants(id),
  actor uuid REFERENCES staff_users(id),
  email text,
  ip text,
  user_agent text,
  data jsonb
);
CREATE INDEX auth_events_staff ON auth_events (staff_id, at DESC);
CREATE INDEX auth_events_tenant ON auth_events (tenant_id, at DESC);
CREATE INDEX auth_events_email ON auth_events (email, kind, at DESC);

ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_kind_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_kind_check
  CHECK (kind IN ('invite', 'reset', 'signin_code', 'transfer'));

-- ---------- who may work in a club, and with which permissions ----------

-- The role a partner-level login works under when it opens a club it may see.
CREATE FUNCTION app_partner_acting_role(p_staff uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE s.role WHEN 'partner_admin' THEN 'owner' WHEN 'navac_support' THEN 'viewer'
                     WHEN 'partner_tech' THEN 'technician' END
  FROM staff_users s WHERE s.id = p_staff AND s.active
$$;

-- Clubs a partner-level login may see: NAVAC admins and support see every club; partner admins their company's;
-- technicians only the clubs assigned to them.
CREATE OR REPLACE FUNCTION app_partner_clubs(p_staff uuid)
RETURNS TABLE (id uuid, slug text, name text, partner text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name, p.name, t.created_at
  FROM staff_users s
  JOIN tenants t ON (
       (s.role IN ('partner_admin', 'navac_support') AND (s.partner_id IS NULL OR t.partner_id = s.partner_id))
    OR (s.role = 'partner_tech' AND t.partner_id = s.partner_id
        AND EXISTS (SELECT 1 FROM partner_assignments a WHERE a.staff_id = s.id AND a.tenant_id = t.id)))
  LEFT JOIN partners p ON p.id = t.partner_id
  WHERE s.id = p_staff AND s.active AND s.role <> 'club'
  ORDER BY t.name
$$;

-- Everything this login may do in this club right now (empty = no access).
CREATE FUNCTION app_staff_perms(p_staff uuid, p_tenant uuid) RETURNS TABLE (role text, perms text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind text; v_role text; v_grants text[]; v_denies text[];
BEGIN
  SELECT s.role INTO v_kind FROM staff_users s WHERE s.id = p_staff AND s.active;
  IF v_kind IS NULL OR p_tenant IS NULL THEN RETURN; END IF;
  IF v_kind = 'club' THEN
    SELECT m.role, m.grants, m.denies INTO v_role, v_grants, v_denies FROM club_memberships m
    WHERE m.staff_id = p_staff AND m.tenant_id = p_tenant AND m.removed_at IS NULL;
    IF v_role IS NULL THEN RETURN; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM app_partner_clubs(p_staff) c WHERE c.id = p_tenant) THEN RETURN; END IF;
    v_role := app_partner_acting_role(p_staff);
    v_grants := '{}'; v_denies := '{}';
  END IF;
  role := v_role;
  perms := ARRAY(
    SELECT DISTINCT x FROM (
      SELECT rp.perm AS x FROM role_permissions rp WHERE rp.role = v_role
      UNION SELECT unnest(v_grants)
    ) u
    WHERE v_role = 'owner' OR NOT (x = ANY (v_denies))
    ORDER BY x);
  RETURN NEXT;
END $$;

CREATE FUNCTION app_can(p_staff uuid, p_tenant uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT p_perm = ANY (perms) FROM app_staff_perms(p_staff, p_tenant)), false)
$$;

-- "Acts as owner" for team rules: the owner, or a partner admin / NAVAC admin who opened the club.
CREATE FUNCTION app_is_club_owner(p_staff uuid, p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT role = 'owner' FROM app_staff_perms(p_staff, p_tenant)), false)
$$;

-- Clubs this login belongs to, for the "choose club" screen and the club switcher.
CREATE FUNCTION app_my_clubs(p_staff uuid) RETURNS TABLE (tenant_id uuid, name text, slug text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, t.slug, m.role FROM club_memberships m JOIN tenants t ON t.id = m.tenant_id
  JOIN staff_users s ON s.id = m.staff_id
  WHERE m.staff_id = p_staff AND m.removed_at IS NULL AND s.active AND s.role = 'club'
  ORDER BY t.name
$$;

-- Remember the club someone last worked in (their default next time).
CREATE FUNCTION app_staff_last_club(p_staff uuid, p_tenant uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE staff_users SET tenant_id = p_tenant
  WHERE id = p_staff AND role = 'club'
    AND EXISTS (SELECT 1 FROM club_memberships m WHERE m.staff_id = p_staff AND m.tenant_id = p_tenant AND m.removed_at IS NULL)
$$;

-- ---------- club team ----------
CREATE FUNCTION app_club_team(p_tenant uuid)
RETURNS TABLE (id uuid, name text, email text, phone text, role text, grants text[], denies text[],
               accepted_at timestamptz, invited_at timestamptz, member_since timestamptz, last_seen timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, s.phone, m.role, m.grants, m.denies, s.accepted_at, s.invited_at, m.created_at,
         (SELECT max(a.last_seen_at) FROM auth_sessions a WHERE a.staff_id = s.id AND a.tenant_id = p_tenant)
  FROM club_memberships m JOIN staff_users s ON s.id = m.staff_id
  WHERE m.tenant_id = p_tenant AND m.removed_at IS NULL
  ORDER BY (m.role = 'owner') DESC, s.accepted_at IS NULL, s.name
$$;

CREATE FUNCTION app_club_owner(p_tenant uuid) RETURNS TABLE (id uuid, name text, email text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, s.phone FROM club_memberships m JOIN staff_users s ON s.id = m.staff_id
  WHERE m.tenant_id = p_tenant AND m.role = 'owner' AND m.removed_at IS NULL
$$;

-- Names for reports (who recorded a payment): everyone who has ever been in this club, plus partner logins.
CREATE OR REPLACE FUNCTION app_staff_names()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name FROM staff_users s
  WHERE s.id IN (SELECT m.staff_id FROM club_memberships m
                 WHERE m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
     OR s.role <> 'club'
$$;

-- Team rules shared by role changes, fine-tuning and removal. Raises when the actor may not touch the target.
CREATE FUNCTION app_team_guard(p_actor uuid, p_tenant uuid, p_staff uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target text;
BEGIN
  IF NOT app_can(p_actor, p_tenant, 'team.manage') THEN RAISE EXCEPTION 'not allowed: team'; END IF;
  IF p_actor = p_staff THEN RAISE EXCEPTION 'not allowed: yourself'; END IF;
  SELECT m.role INTO v_target FROM club_memberships m
  WHERE m.tenant_id = p_tenant AND m.staff_id = p_staff AND m.removed_at IS NULL;
  IF v_target IS NULL THEN RAISE EXCEPTION 'not in this club'; END IF;
  IF v_target = 'owner' THEN RAISE EXCEPTION 'not allowed: owner'; END IF;
  IF v_target = 'admin' AND NOT app_is_club_owner(p_actor, p_tenant) THEN RAISE EXCEPTION 'not allowed: admin'; END IF;
  RETURN v_target;
END $$;

CREATE FUNCTION app_set_member_role(p_actor uuid, p_tenant uuid, p_staff uuid, p_role text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text;
BEGIN
  v_old := app_team_guard(p_actor, p_tenant, p_staff);
  IF p_role NOT IN ('admin', 'manager', 'reception', 'accountant', 'viewer') THEN RAISE EXCEPTION 'bad role'; END IF;
  IF p_role = 'admin' AND NOT app_is_club_owner(p_actor, p_tenant) THEN RAISE EXCEPTION 'not allowed: admin'; END IF;
  UPDATE club_memberships SET role = p_role, updated_at = now() WHERE tenant_id = p_tenant AND staff_id = p_staff;
  RETURN v_old;
END $$;

CREATE FUNCTION app_set_member_perms(p_actor uuid, p_tenant uuid, p_staff uuid, p_grants text[], p_denies text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_known text[] := ARRAY(SELECT DISTINCT perm FROM role_permissions WHERE perm <> 'club.own');
BEGIN
  PERFORM app_team_guard(p_actor, p_tenant, p_staff);
  IF NOT (coalesce(p_grants, '{}') <@ v_known AND coalesce(p_denies, '{}') <@ v_known) THEN
    RAISE EXCEPTION 'unknown permission';
  END IF;
  IF 'team.manage' = ANY (p_grants) AND NOT app_is_club_owner(p_actor, p_tenant) THEN
    RAISE EXCEPTION 'not allowed: team';
  END IF;
  UPDATE club_memberships SET grants = coalesce(p_grants, '{}'), denies = coalesce(p_denies, '{}'), updated_at = now()
  WHERE tenant_id = p_tenant AND staff_id = p_staff;
END $$;

-- Remove someone from a club. Nothing they did is deleted. A pending invitation is cancelled with it.
CREATE FUNCTION app_remove_member(p_actor uuid, p_tenant uuid, p_staff uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_team_guard(p_actor, p_tenant, p_staff);
  UPDATE club_memberships SET removed_at = now(), removed_by = p_actor, updated_at = now()
  WHERE tenant_id = p_tenant AND staff_id = p_staff;
  UPDATE auth_tokens SET used_at = now()
  WHERE staff_id = p_staff AND kind = 'invite' AND used_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM club_memberships m WHERE m.staff_id = p_staff AND m.removed_at IS NULL);
  UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'removed'
  WHERE staff_id = p_staff AND tenant_id = p_tenant AND revoked_at IS NULL;
END $$;

-- Hand the club to an admin. Called when the admin accepts; the old owner becomes an admin.
CREATE FUNCTION app_transfer_ownership(p_from uuid, p_tenant uuid, p_to uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM club_memberships WHERE tenant_id = p_tenant AND staff_id = p_from
                 AND role = 'owner' AND removed_at IS NULL) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM club_memberships m JOIN staff_users s ON s.id = m.staff_id
                 WHERE m.tenant_id = p_tenant AND m.staff_id = p_to AND m.role = 'admin' AND m.removed_at IS NULL
                   AND s.active AND s.accepted_at IS NOT NULL) THEN RETURN false; END IF;
  UPDATE club_memberships SET role = 'admin', updated_at = now() WHERE tenant_id = p_tenant AND staff_id = p_from;
  UPDATE club_memberships SET role = 'owner', grants = '{}', denies = '{}', updated_at = now()
  WHERE tenant_id = p_tenant AND staff_id = p_to;
  RETURN true;
END $$;

-- ---------- invitations (redefined for memberships and partner teams) ----------
-- Club roles: whoever holds team.manage invites manager, front desk, accountant, viewer; only the owner (or the
-- partner / NAVAC acting as owner) invites an admin; owners come only from the partner when a club is created.
-- Partner roles: NAVAC admins invite anyone; a partner admin invites admins and technicians for their own company.
-- An email that already has a club login is simply added to the club (one login, several clubs).
CREATE OR REPLACE FUNCTION app_invite_staff(p_inviter uuid, p_email text, p_name text, p_phone text, p_role text,
                                            p_tenant uuid, p_partner uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv staff_users; v_id uuid; v_existing staff_users; v_platform boolean; v_kind text;
BEGIN
  SELECT * INTO v_inv FROM staff_users WHERE id = p_inviter AND active;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'inviter not active'; END IF;
  v_platform := app_is_platform(p_inviter);
  SELECT * INTO v_existing FROM staff_users WHERE email = lower(trim(p_email));

  IF p_role IN ('owner', 'admin', 'manager', 'reception', 'accountant', 'viewer') THEN
    IF p_tenant IS NULL THEN RAISE EXCEPTION 'club required'; END IF;
    IF p_role = 'owner' THEN
      IF NOT (v_platform OR (v_inv.role = 'partner_admin'
              AND EXISTS (SELECT 1 FROM app_partner_clubs(p_inviter) c WHERE c.id = p_tenant))) THEN
        RAISE EXCEPTION 'not allowed to invite an owner';
      END IF;
      IF EXISTS (SELECT 1 FROM club_memberships WHERE tenant_id = p_tenant AND role = 'owner' AND removed_at IS NULL)
        THEN RAISE EXCEPTION 'club already has an owner'; END IF;
    ELSIF NOT app_can(p_inviter, p_tenant, 'team.manage') THEN
      RAISE EXCEPTION 'not allowed to invite into this club';
    ELSIF p_role = 'admin' AND NOT app_is_club_owner(p_inviter, p_tenant) THEN
      RAISE EXCEPTION 'only the owner invites an admin';
    END IF;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.role <> 'club' THEN RAISE EXCEPTION 'email belongs to a partner login'; END IF;
      IF EXISTS (SELECT 1 FROM club_memberships WHERE tenant_id = p_tenant AND staff_id = v_existing.id
                 AND removed_at IS NULL) THEN RAISE EXCEPTION 'already in this club'; END IF;
      v_id := v_existing.id;
      IF v_existing.accepted_at IS NOT NULL THEN UPDATE staff_users SET active = true WHERE id = v_id; END IF;
    ELSE
      INSERT INTO staff_users (tenant_id, email, name, phone, role, password_hash, active, invited_by, invited_at)
      VALUES (p_tenant, lower(trim(p_email)), p_name, nullif(p_phone, ''), 'club', 'invited$', false, p_inviter, now())
      RETURNING id INTO v_id;
    END IF;
    INSERT INTO club_memberships (tenant_id, staff_id, role, invited_by)
    VALUES (p_tenant, v_id, p_role, p_inviter)
    ON CONFLICT (tenant_id, staff_id) DO UPDATE
      SET role = excluded.role, grants = '{}', denies = '{}', invited_by = excluded.invited_by,
          created_at = now(), updated_at = now(), removed_at = NULL, removed_by = NULL;
    RETURN v_id;
  END IF;

  IF p_role IN ('partner_admin', 'partner_tech', 'navac_support') THEN
    IF p_tenant IS NOT NULL THEN RAISE EXCEPTION 'partner logins have no club'; END IF;
    IF v_existing.id IS NOT NULL THEN RAISE EXCEPTION 'email already has a login'; END IF;
    IF p_role = 'navac_support' AND p_partner IS NOT NULL THEN RAISE EXCEPTION 'support is NAVAC staff'; END IF;
    IF p_role = 'partner_tech' AND p_partner IS NULL THEN RAISE EXCEPTION 'technician needs a partner'; END IF;
    IF NOT (v_platform OR (v_inv.role = 'partner_admin' AND v_inv.partner_id IS NOT NULL
            AND v_inv.partner_id = p_partner AND p_role IN ('partner_admin', 'partner_tech'))) THEN
      RAISE EXCEPTION 'not allowed to invite this login';
    END IF;
    INSERT INTO staff_users (partner_id, email, name, phone, role, password_hash, active, invited_by, invited_at)
    VALUES (p_partner, lower(trim(p_email)), p_name, nullif(p_phone, ''), p_role, 'invited$', false, p_inviter, now())
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  RAISE EXCEPTION 'bad role';
END $$;

-- A club created by a partner: its owner is a new login waiting for the emailed invitation, or an existing club
-- login (someone who already runs another club) who is simply added as owner.
CREATE OR REPLACE FUNCTION app_create_club(
  p_staff uuid, p_slug text, p_name text, p_timezone text,
  p_owner_email text, p_owner_name text, p_owner_hash text, p_pair_code text, p_bridge_secret text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid; v_tenant uuid; v_site uuid; v_ok boolean; v_owner uuid; v_kind text;
BEGIN
  SELECT true, s.partner_id INTO v_ok, v_partner FROM staff_users s
   WHERE s.id = p_staff AND s.role = 'partner_admin' AND s.active;
  IF v_ok IS NULL THEN RAISE EXCEPTION 'not a partner admin'; END IF;
  SELECT id, role INTO v_owner, v_kind FROM staff_users WHERE email = lower(trim(p_owner_email));
  IF v_owner IS NOT NULL AND v_kind <> 'club' THEN RAISE EXCEPTION 'email belongs to a partner login'; END IF;
  INSERT INTO tenants (partner_id, slug, name, timezone) VALUES (v_partner, p_slug, p_name, p_timezone) RETURNING id INTO v_tenant;
  INSERT INTO sites (tenant_id, name) VALUES (v_tenant, 'Main site') RETURNING id INTO v_site;
  INSERT INTO bridges (tenant_id, site_id, secret, pair_code, pair_expires_at)
    VALUES (v_tenant, v_site, p_bridge_secret, p_pair_code, now() + interval '30 days');
  IF v_owner IS NULL THEN
    INSERT INTO staff_users (tenant_id, partner_id, email, name, role, password_hash, active, invited_by, invited_at)
      VALUES (v_tenant, v_partner, lower(trim(p_owner_email)), p_owner_name, 'club', 'invited$', false, p_staff, now())
      RETURNING id INTO v_owner;
  END IF;
  INSERT INTO club_memberships (tenant_id, staff_id, role, invited_by) VALUES (v_tenant, v_owner, 'owner', p_staff);
  INSERT INTO tenant_settings (tenant_id, data) VALUES (v_tenant, '{}');
  INSERT INTO audit_log (tenant_id, actor, action, entity, data)
    VALUES (v_tenant, p_staff::text, 'club.created', v_tenant::text, jsonb_build_object('slug', p_slug, 'owner', lower(p_owner_email)));
  RETURN v_tenant;
END $$;

-- The owner of a club the partner just created, if that owner has not accepted yet (else null).
CREATE OR REPLACE FUNCTION app_club_owner_pending(p_staff uuid, p_tenant uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_partner_clubs(p_staff) c WHERE c.id = p_tenant) THEN
    RAISE EXCEPTION 'not your club';
  END IF;
  SELECT s.id INTO v FROM club_memberships m JOIN staff_users s ON s.id = m.staff_id
  WHERE m.tenant_id = p_tenant AND m.role = 'owner' AND m.removed_at IS NULL AND s.accepted_at IS NULL;
  RETURN v;
END $$;

-- ---------- partner teams ----------
-- Logins a partner-level person may manage: NAVAC admins see every partner-level login; a partner admin sees
-- their own company's admins and technicians.
CREATE FUNCTION app_partner_team(p_actor uuid)
RETURNS TABLE (id uuid, name text, email text, phone text, role text, partner text, partner_id uuid,
               active boolean, accepted_at timestamptz, clubs text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, s.phone, s.role, coalesce(p.name, 'NAVAC Global'), s.partner_id, s.active,
         s.accepted_at,
         ARRAY(SELECT t.name FROM partner_assignments a JOIN tenants t ON t.id = a.tenant_id
               WHERE a.staff_id = s.id ORDER BY t.name)
  FROM staff_users s LEFT JOIN partners p ON p.id = s.partner_id
  JOIN staff_users me ON me.id = p_actor AND me.active AND me.role = 'partner_admin'
  WHERE s.role <> 'club'
    AND (me.partner_id IS NULL OR s.partner_id = me.partner_id)
  ORDER BY s.partner_id NULLS FIRST, s.role, s.name
$$;

CREATE FUNCTION app_partner_can_manage(p_actor uuid, p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_actor <> p_staff AND EXISTS (SELECT 1 FROM app_partner_team(p_actor) t WHERE t.id = p_staff)
$$;

CREATE FUNCTION app_partner_set_active(p_actor uuid, p_staff uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_partner_can_manage(p_actor, p_staff) THEN RAISE EXCEPTION 'not allowed'; END IF;
  UPDATE staff_users SET active = p_active WHERE id = p_staff AND role <> 'club' AND accepted_at IS NOT NULL;
  IF NOT p_active THEN
    UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'removed' WHERE staff_id = p_staff AND revoked_at IS NULL;
  END IF;
END $$;

-- Which clubs a technician works in (only clubs of the technician's own partner).
CREATE FUNCTION app_partner_assign(p_actor uuid, p_staff uuid, p_tenants uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid;
BEGIN
  IF NOT app_partner_can_manage(p_actor, p_staff) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT partner_id INTO v_partner FROM staff_users WHERE id = p_staff AND role = 'partner_tech';
  IF v_partner IS NULL THEN RAISE EXCEPTION 'not a technician'; END IF;
  DELETE FROM partner_assignments WHERE staff_id = p_staff;
  INSERT INTO partner_assignments (staff_id, tenant_id)
  SELECT p_staff, t.id FROM tenants t WHERE t.id = ANY (coalesce(p_tenants, '{}')) AND t.partner_id = v_partner;
  UPDATE auth_sessions SET tenant_id = NULL, acting_role = NULL
  WHERE staff_id = p_staff AND revoked_at IS NULL AND NOT (tenant_id = ANY (coalesce(p_tenants, '{}')));
END $$;

-- Old helpers that knew only one club per login.
DROP FUNCTION IF EXISTS app_add_staff(text, text, text, text);
DROP FUNCTION IF EXISTS app_set_staff_active(uuid, boolean);
DROP FUNCTION IF EXISTS app_tenant_staff();
DROP FUNCTION IF EXISTS app_platform_add_partner(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS app_platform_set_partner_active(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS app_platform_partners(uuid);

REVOKE EXECUTE ON FUNCTION app_partner_acting_role(uuid), app_staff_perms(uuid, uuid), app_can(uuid, uuid, text),
  app_is_club_owner(uuid, uuid), app_my_clubs(uuid), app_staff_last_club(uuid, uuid), app_club_team(uuid),
  app_club_owner(uuid), app_team_guard(uuid, uuid, uuid), app_set_member_role(uuid, uuid, uuid, text),
  app_set_member_perms(uuid, uuid, uuid, text[], text[]), app_remove_member(uuid, uuid, uuid),
  app_transfer_ownership(uuid, uuid, uuid), app_partner_team(uuid), app_partner_can_manage(uuid, uuid),
  app_partner_set_active(uuid, uuid, boolean), app_partner_assign(uuid, uuid, uuid[]) FROM PUBLIC;

-- Clubs a login still belongs to (0 = every invitation was cancelled).
CREATE FUNCTION app_staff_club_count(p_staff uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM club_memberships WHERE staff_id = p_staff AND removed_at IS NULL
$$;
REVOKE EXECUTE ON FUNCTION app_staff_club_count(uuid) FROM PUBLIC;
