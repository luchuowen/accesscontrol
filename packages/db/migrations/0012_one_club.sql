-- One login belongs to one club (Owen, 2 Oct 2026): a person who works at two clubs uses a different email for
-- each, so every club stands on its own subscription. And, for now, at most 5 team members per club besides the
-- owner (invited or active); this becomes a per-plan allowance when subscriptions are built.

CREATE UNIQUE INDEX club_one_club_per_login ON club_memberships (staff_id) WHERE removed_at IS NULL;

CREATE OR REPLACE FUNCTION app_club_seats(p_tenant uuid) RETURNS TABLE (used int, cap int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int, 5 FROM club_memberships
  WHERE tenant_id = p_tenant AND removed_at IS NULL AND role <> 'owner'
$$;
REVOKE EXECUTE ON FUNCTION app_club_seats(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_invite_staff(p_inviter uuid, p_email text, p_name text, p_phone text, p_role text,
                                            p_tenant uuid, p_partner uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv staff_users; v_id uuid; v_existing staff_users; v_platform boolean;
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
    ELSE
      IF NOT app_can(p_inviter, p_tenant, 'team.manage') THEN
        RAISE EXCEPTION 'not allowed to invite into this club';
      END IF;
      IF p_role = 'admin' AND NOT app_is_club_owner(p_inviter, p_tenant) THEN
        RAISE EXCEPTION 'only the owner invites an admin';
      END IF;
      IF (SELECT used >= cap FROM app_club_seats(p_tenant)) THEN RAISE EXCEPTION 'team limit reached'; END IF;
    END IF;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.role <> 'club' THEN RAISE EXCEPTION 'email belongs to a partner login'; END IF;
      IF EXISTS (SELECT 1 FROM club_memberships WHERE staff_id = v_existing.id AND removed_at IS NULL) THEN
        RAISE EXCEPTION 'email belongs to another club';
      END IF;
      -- A former member of a club (removed everywhere) can be invited again; they keep their login.
      v_id := v_existing.id;
      UPDATE staff_users SET tenant_id = p_tenant, active = (accepted_at IS NOT NULL) WHERE id = v_id;
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

-- A new club's owner must be a new login, or a club login no longer in any club.
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
  IF v_owner IS NOT NULL AND EXISTS (SELECT 1 FROM club_memberships WHERE staff_id = v_owner AND removed_at IS NULL)
    THEN RAISE EXCEPTION 'email belongs to another club'; END IF;
  INSERT INTO tenants (partner_id, slug, name, timezone) VALUES (v_partner, p_slug, p_name, p_timezone) RETURNING id INTO v_tenant;
  INSERT INTO sites (tenant_id, name) VALUES (v_tenant, 'Main site') RETURNING id INTO v_site;
  INSERT INTO bridges (tenant_id, site_id, secret, pair_code, pair_expires_at)
    VALUES (v_tenant, v_site, p_bridge_secret, p_pair_code, now() + interval '30 days');
  IF v_owner IS NULL THEN
    INSERT INTO staff_users (tenant_id, partner_id, email, name, role, password_hash, active, invited_by, invited_at)
      VALUES (v_tenant, v_partner, lower(trim(p_owner_email)), p_owner_name, 'club', 'invited$', false, p_staff, now())
      RETURNING id INTO v_owner;
  ELSE
    UPDATE staff_users SET tenant_id = v_tenant WHERE id = v_owner;
  END IF;
  INSERT INTO club_memberships (tenant_id, staff_id, role, invited_by) VALUES (v_tenant, v_owner, 'owner', p_staff);
  INSERT INTO tenant_settings (tenant_id, data) VALUES (v_tenant, '{}');
  INSERT INTO audit_log (tenant_id, actor, action, entity, data)
    VALUES (v_tenant, p_staff::text, 'club.created', v_tenant::text, jsonb_build_object('slug', p_slug, 'owner', lower(p_owner_email)));
  RETURN v_tenant;
END $$;

-- Clubs without an owner yet (or whose owner never accepted), for "Invite owner" on the clubs list.
CREATE OR REPLACE FUNCTION app_partner_club_owners(p_staff uuid)
RETURNS TABLE (tenant_id uuid, owner_name text, owner_email text, accepted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, s.name, s.email, s.accepted_at IS NOT NULL
  FROM app_partner_clubs(p_staff) c
  LEFT JOIN club_memberships m ON m.tenant_id = c.id AND m.role = 'owner' AND m.removed_at IS NULL
  LEFT JOIN staff_users s ON s.id = m.staff_id
$$;
REVOKE EXECUTE ON FUNCTION app_partner_club_owners(uuid) FROM PUBLIC;
