-- Suspend a team member's login (3 Oct 2026): they can't sign in to the club or use an open session until restored.
-- Their record, role and history stay. Owners can suspend anyone; admins anyone except admins (same rules as
-- removing). Nobody can suspend themselves or the owner.
ALTER TABLE club_memberships ADD COLUMN suspended_at timestamptz;
ALTER TABLE club_memberships ADD COLUMN suspended_by uuid;

CREATE OR REPLACE FUNCTION app_staff_perms(p_staff uuid, p_tenant uuid) RETURNS TABLE (role text, perms text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind text; v_role text; v_grants text[]; v_denies text[];
BEGIN
  SELECT s.role INTO v_kind FROM staff_users s WHERE s.id = p_staff AND s.active;
  IF v_kind IS NULL OR p_tenant IS NULL THEN RETURN; END IF;
  IF v_kind = 'club' THEN
    SELECT m.role, m.grants, m.denies INTO v_role, v_grants, v_denies FROM club_memberships m
    WHERE m.staff_id = p_staff AND m.tenant_id = p_tenant AND m.removed_at IS NULL AND m.suspended_at IS NULL;
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
      -- installers: partner admins (and NAVAC) set up doors in the clubs they can open
      UNION SELECT 'doors.setup' WHERE v_kind IN ('partner_admin', 'partner_tech')
    ) u
    WHERE (v_role = 'owner' OR NOT (x = ANY (v_denies)))
      AND (x <> 'doors.setup' OR v_kind IN ('partner_admin', 'partner_tech'))
    ORDER BY x);
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION app_my_clubs(p_staff uuid) RETURNS TABLE (tenant_id uuid, name text, slug text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, t.slug, m.role FROM club_memberships m JOIN tenants t ON t.id = m.tenant_id
  JOIN staff_users s ON s.id = m.staff_id
  WHERE m.staff_id = p_staff AND m.removed_at IS NULL AND m.suspended_at IS NULL AND s.active AND s.role = 'club'
  ORDER BY t.name
$$;

DROP FUNCTION app_club_team(uuid);
CREATE FUNCTION app_club_team(p_tenant uuid)
RETURNS TABLE (id uuid, name text, email text, phone text, role text, grants text[], denies text[],
               accepted_at timestamptz, invited_at timestamptz, member_since timestamptz, last_seen timestamptz,
               suspended_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, s.phone, m.role, m.grants, m.denies, s.accepted_at, s.invited_at, m.created_at,
         (SELECT max(a.last_seen_at) FROM auth_sessions a WHERE a.staff_id = s.id AND a.tenant_id = p_tenant),
         m.suspended_at
  FROM club_memberships m JOIN staff_users s ON s.id = m.staff_id
  WHERE m.tenant_id = p_tenant AND m.removed_at IS NULL
  ORDER BY (m.role = 'owner') DESC, s.accepted_at IS NULL, s.name
$$;

CREATE FUNCTION app_suspend_member(p_actor uuid, p_tenant uuid, p_staff uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_team_guard(p_actor, p_tenant, p_staff);
  UPDATE club_memberships SET suspended_at = CASE WHEN p_on THEN now() END,
         suspended_by = CASE WHEN p_on THEN p_actor END, updated_at = now()
  WHERE tenant_id = p_tenant AND staff_id = p_staff;
  IF p_on THEN
    UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'suspended'
    WHERE staff_id = p_staff AND tenant_id = p_tenant AND revoked_at IS NULL;
  END IF;
END $$;
