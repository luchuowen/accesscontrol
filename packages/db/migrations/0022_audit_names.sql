-- System audit (3 Oct 2026): names for everyone who has done something in this club, including partner and NAVAC
-- logins (shown as "Name · Partner"), so the audit never says "Someone". Only for the club in context.
CREATE FUNCTION app_audit_names(p_tenant uuid) RETURNS TABLE (id uuid, name text, partner boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.role <> 'club'
  FROM staff_users s
  WHERE p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (EXISTS (SELECT 1 FROM club_memberships m WHERE m.staff_id = s.id AND m.tenant_id = p_tenant)
         OR EXISTS (SELECT 1 FROM auth_events e WHERE e.tenant_id = p_tenant AND (e.staff_id = s.id OR e.actor = s.id))
         OR EXISTS (SELECT 1 FROM audit_log a WHERE a.tenant_id = p_tenant AND a.actor = s.id::text))
$$;
