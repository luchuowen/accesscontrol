-- NAVAC can say which partner sells and installs a club (its shares follow), when adding it or later.
CREATE FUNCTION app_platform_set_club_partner(p_staff uuid, p_tenant uuid, p_partner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  IF p_partner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM partners WHERE id = p_partner) THEN
    RAISE EXCEPTION 'unknown partner';
  END IF;
  UPDATE tenants SET partner_id = p_partner WHERE id = p_tenant;
  INSERT INTO audit_log (tenant_id, actor, action, data)
  VALUES (p_tenant, p_staff::text, 'club.partner_set', jsonb_build_object('partner', p_partner));
END $$;
