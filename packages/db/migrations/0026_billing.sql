-- Lango subscription billing (3 Oct 2026). NAVAC sets each club's plan (name, fee per cycle, cycle, paid-until)
-- from the SaaS console; the club owner pays NAVAC by M-Pesa prompt and each confirmed payment moves paid-until on.
-- A fee left empty means the price is still being agreed: the club sees its plan but has nothing to pay yet.
CREATE TABLE club_plans (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  plan_name text NOT NULL DEFAULT 'Lango',
  fee_kes int CHECK (fee_kes IS NULL OR fee_kes >= 10),
  cycle text NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly', 'quarterly', 'yearly')),
  paid_until date,
  billing_phone text,
  billing_email text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE subscription_invoice_seq;
CREATE TABLE subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_no text NOT NULL UNIQUE DEFAULT 'LSUB-' || lpad(nextval('subscription_invoice_seq')::text, 5, '0'),
  plan_name text NOT NULL,
  cycles int NOT NULL CHECK (cycles BETWEEN 1 AND 12),
  period_from date NOT NULL,
  period_to date NOT NULL,
  amount_kes int NOT NULL CHECK (amount_kes >= 10),
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  provider_ref text,
  receipt_ref text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX subscription_invoices_pending ON subscription_invoices (status, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['club_plans', 'subscription_invoices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                   WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- NAVAC only: set or change a club's plan.
CREATE FUNCTION app_platform_set_plan(p_staff uuid, p_tenant uuid, p_name text, p_fee int, p_cycle text,
                                      p_paid_until date, p_phone text, p_email text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  INSERT INTO club_plans (tenant_id, plan_name, fee_kes, cycle, paid_until, billing_phone, billing_email, updated_by)
  VALUES (p_tenant, coalesce(nullif(trim(p_name), ''), 'Lango'), p_fee, p_cycle, p_paid_until, nullif(p_phone, ''),
          nullif(p_email, ''), p_staff)
  ON CONFLICT (tenant_id) DO UPDATE SET plan_name = excluded.plan_name, fee_kes = excluded.fee_kes,
    cycle = excluded.cycle, paid_until = excluded.paid_until, billing_phone = excluded.billing_phone,
    billing_email = excluded.billing_email, updated_by = excluded.updated_by, updated_at = now();
  INSERT INTO audit_log (tenant_id, actor, action, data)
  VALUES (p_tenant, p_staff::text, 'billing.plan_set', jsonb_build_object('plan', p_name, 'fee', p_fee, 'cycle', p_cycle,
          'paidUntil', p_paid_until));
END $$;

-- Payments waiting for M-Pesa, across clubs (the poller and NAVAC's webhook re-check each with the gateway).
CREATE FUNCTION app_pending_sub_payments()
RETURNS TABLE (id uuid, tenant_id uuid, provider_ref text, amount_kes int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, tenant_id, provider_ref, amount_kes FROM subscription_invoices
  WHERE status = 'pending' AND provider_ref IS NOT NULL
    AND created_at > now() - interval '24 hours' AND created_at < now() - interval '30 seconds'
  ORDER BY created_at LIMIT 50
$$;
