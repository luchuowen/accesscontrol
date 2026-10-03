-- A confirmed subscription payment moves the club's paid-until date (club_plans is read-only for the app).
CREATE FUNCTION app_plan_paid(p_invoice uuid) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid; v_to date;
BEGIN
  SELECT tenant_id, period_to INTO v_t, v_to FROM subscription_invoices WHERE id = p_invoice AND status = 'paid';
  IF v_t IS NULL THEN RETURN NULL; END IF;
  UPDATE club_plans SET paid_until = greatest(coalesce(paid_until, v_to), v_to), updated_at = now() WHERE tenant_id = v_t;
  RETURN v_to;
END $$;
