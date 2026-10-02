-- Roles each club can tune (3 Oct 2026): the owner can add or remove rights for a role in their club (e.g. let
-- front desk assign unmatched payments). Overrides sit on top of the platform defaults; per-person changes on top
-- of that. The owner role, club.own and doors.setup can't be changed.
CREATE TABLE club_role_perms (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'reception', 'accountant', 'viewer')),
  perm text NOT NULL,
  allow boolean NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role, perm)
);
ALTER TABLE club_role_perms ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_role_perms FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON club_role_perms
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

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
      -- the role's defaults, as this club has tuned them
      SELECT rp.perm AS x FROM role_permissions rp WHERE rp.role = v_role
        AND NOT EXISTS (SELECT 1 FROM club_role_perms c WHERE c.tenant_id = p_tenant AND c.role = v_role
                        AND c.perm = rp.perm AND NOT c.allow)
      UNION SELECT c.perm FROM club_role_perms c WHERE c.tenant_id = p_tenant AND c.role = v_role AND c.allow
        AND v_role <> 'owner'
      UNION SELECT unnest(v_grants)
      -- installers: partner admins (and NAVAC) set up doors in the clubs they can open
      UNION SELECT 'doors.setup' WHERE v_kind IN ('partner_admin', 'partner_tech')
    ) u
    WHERE (v_role = 'owner' OR NOT (x = ANY (v_denies)))
      AND (x <> 'doors.setup' OR v_kind IN ('partner_admin', 'partner_tech'))
    ORDER BY x);
  RETURN NEXT;
END $$;

-- This club's rights per role (defaults with the club's changes), for the role table.
CREATE FUNCTION app_club_role_perms(p_tenant uuid) RETURNS TABLE (role text, perm text, is_default boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rp.role, rp.perm, true FROM role_permissions rp
  WHERE NOT EXISTS (SELECT 1 FROM club_role_perms c WHERE c.tenant_id = p_tenant AND c.role = rp.role AND c.perm = rp.perm AND NOT c.allow)
  UNION ALL
  SELECT c.role, c.perm, false FROM club_role_perms c
  WHERE c.tenant_id = p_tenant AND c.allow
    AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = c.role AND rp.perm = c.perm)
$$;

-- Owner only. Turning a right back to its default removes the override.
CREATE FUNCTION app_set_role_perm(p_actor uuid, p_tenant uuid, p_role text, p_perm text, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_default boolean;
BEGIN
  IF NOT app_is_club_owner(p_actor, p_tenant) THEN RAISE EXCEPTION 'not allowed: only the owner'; END IF;
  IF p_role NOT IN ('admin', 'manager', 'reception', 'accountant', 'viewer') THEN RAISE EXCEPTION 'bad role'; END IF;
  IF p_perm IN ('club.own', 'doors.setup')
     OR NOT EXISTS (SELECT 1 FROM role_permissions WHERE perm = p_perm) THEN RAISE EXCEPTION 'unknown permission'; END IF;
  v_default := EXISTS (SELECT 1 FROM role_permissions WHERE role = p_role AND perm = p_perm);
  IF v_default = p_on THEN
    DELETE FROM club_role_perms WHERE tenant_id = p_tenant AND role = p_role AND perm = p_perm;
  ELSE
    INSERT INTO club_role_perms (tenant_id, role, perm, allow, updated_by) VALUES (p_tenant, p_role, p_perm, p_on, p_actor)
    ON CONFLICT (tenant_id, role, perm) DO UPDATE SET allow = excluded.allow, updated_by = excluded.updated_by, updated_at = now();
  END IF;
END $$;

-- Owner only: put a role back to the platform defaults.
CREATE FUNCTION app_reset_role_perms(p_actor uuid, p_tenant uuid, p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_club_owner(p_actor, p_tenant) THEN RAISE EXCEPTION 'not allowed: only the owner'; END IF;
  DELETE FROM club_role_perms WHERE tenant_id = p_tenant AND role = p_role;
END $$;
