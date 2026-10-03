-- Review fixes (3 Oct 2026).
-- 1. A club's role tuning applies to its own staff only, never to NAVAC or partner logins acting in the club.
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
        AND (v_kind <> 'club' OR NOT EXISTS (SELECT 1 FROM club_role_perms c WHERE c.tenant_id = p_tenant
                        AND c.role = v_role AND c.perm = rp.perm AND NOT c.allow))
      UNION SELECT c.perm FROM club_role_perms c WHERE c.tenant_id = p_tenant AND c.role = v_role AND c.allow
        AND v_role <> 'owner' AND v_kind = 'club'
      UNION SELECT unnest(v_grants)
      -- installers: partner admins (and NAVAC) set up doors in the clubs they can open
      UNION SELECT 'doors.setup' WHERE v_kind IN ('partner_admin', 'partner_tech')
    ) u
    WHERE (v_role = 'owner' OR NOT (x = ANY (v_denies)))
      AND (x <> 'doors.setup' OR v_kind IN ('partner_admin', 'partner_tech'))
    ORDER BY x);
  RETURN NEXT;
END $$;

-- 2. A confirmed subscription payment extends from the later of paid-until and the payment day, by what was paid
--    for, so two payments always buy two periods. The invoice records the period actually covered.
ALTER TABLE subscription_invoices DROP CONSTRAINT IF EXISTS subscription_invoices_status_check;
ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'expired'));

CREATE OR REPLACE FUNCTION app_plan_paid(p_invoice uuid) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid; v_cycles int; v_months int; v_from date; v_to date; v_today date;
BEGIN
  SELECT tenant_id, cycles INTO v_t, v_cycles FROM subscription_invoices WHERE id = p_invoice AND status = 'paid';
  IF v_t IS NULL THEN RETURN NULL; END IF;
  v_today := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  SELECT CASE cycle WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END * v_cycles,
         greatest(coalesce(paid_until + 1, v_today), v_today)
    INTO v_months, v_from FROM club_plans WHERE tenant_id = v_t FOR UPDATE;
  IF v_from IS NULL THEN RETURN NULL; END IF;
  v_to := (v_from + make_interval(months => v_months) - interval '1 day')::date;
  UPDATE club_plans SET paid_until = v_to, updated_at = now() WHERE tenant_id = v_t;
  UPDATE subscription_invoices SET period_from = v_from, period_to = v_to WHERE id = p_invoice;
  RETURN v_to;
END $$;

-- 3. Prompts nobody paid within a day are closed, so the billing list never shows them as waiting forever.
CREATE FUNCTION app_expire_sub_payments() RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH x AS (UPDATE subscription_invoices SET status = 'expired'
             WHERE status = 'pending' AND created_at < now() - interval '24 hours' RETURNING 1)
  SELECT count(*)::int FROM x
$$;
