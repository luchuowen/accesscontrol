-- Door setup is the installer's job (2 Oct 2026). Pairing the door PC, re-reading AxTraxNG and linking each door to
-- an area need the door PC, the AxTraxNG login and knowing which reader is which door. That is the partner's
-- technician (or a partner/NAVAC admin), never the club. Club owners keep doors.manage, which now means seeing the
-- doors: online or not, what each opens, who went in. doors.setup is never a club role's and can't be granted to
-- club staff.
INSERT INTO role_permissions (role, perm) VALUES ('technician', 'doors.setup') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app_staff_perms(p_staff uuid, p_tenant uuid) RETURNS TABLE (role text, perms text[])
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
      -- installers: partner admins (and NAVAC) set up doors in the clubs they can open
      UNION SELECT 'doors.setup' WHERE v_kind IN ('partner_admin', 'partner_tech')
    ) u
    WHERE (v_role = 'owner' OR NOT (x = ANY (v_denies)))
      AND (x <> 'doors.setup' OR v_kind IN ('partner_admin', 'partner_tech'))
    ORDER BY x);
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION app_set_member_perms(p_actor uuid, p_tenant uuid, p_staff uuid, p_grants text[], p_denies text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_known text[] := ARRAY(SELECT DISTINCT perm FROM role_permissions WHERE perm NOT IN ('club.own', 'doors.setup'));
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
