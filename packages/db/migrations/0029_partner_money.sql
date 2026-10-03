-- Partner money (3 Oct 2026): each partner's terms with NAVAC, the setup fee a club pays, the partner's share of every
-- setup fee and subscription (earned automatically when the club's payment is confirmed) and monthly payouts.
-- These tables are NAVAC's books: the app role cannot read or write them directly; everything goes through the
-- functions below, which check who is asking. Gateway fees, SMS margin and NAVAC's own income never leave
-- app_platform_* functions.

CREATE TABLE partner_terms (
  partner_id    uuid PRIMARY KEY REFERENCES partners(id),
  setup_pct     numeric(5,2) CHECK (setup_pct BETWEEN 0 AND 100),
  sub_pct       numeric(5,2) CHECK (sub_pct BETWEEN 0 AND 100),
  sub_months    int CHECK (sub_months IS NULL OR sub_months BETWEEN 1 AND 120),  -- null: for as long as the club pays
  hold_days     int NOT NULL DEFAULT 14 CHECK (hold_days BETWEEN 0 AND 90),
  wht_pct       numeric(5,2) NOT NULL DEFAULT 0 CHECK (wht_pct BETWEEN 0 AND 30),
  payout_method text CHECK (payout_method IN ('mpesa', 'paybill', 'till', 'bank')),
  payout_to     text,
  kra_pin       text,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The one-time setup fee NAVAC agrees with a club (null: none or not agreed yet). Paid like a subscription invoice.
ALTER TABLE club_plans ADD COLUMN setup_fee_kes int CHECK (setup_fee_kes IS NULL OR setup_fee_kes >= 10);
ALTER TABLE subscription_invoices ADD COLUMN kind text NOT NULL DEFAULT 'subscription'
  CHECK (kind IN ('subscription', 'setup'));
ALTER TABLE subscription_invoices ALTER COLUMN period_from DROP NOT NULL, ALTER COLUMN period_to DROP NOT NULL;

CREATE TABLE partner_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  statement_no text NOT NULL UNIQUE DEFAULT 'LPAY-' || lpad(nextval('subscription_invoice_seq')::text, 5, '0'),
  gross_kes    int NOT NULL,
  wht_kes      int NOT NULL DEFAULT 0,
  net_kes      int NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'paid', 'failed')),
  etims_ref    text,
  method       text,
  sent_to      text,
  provider_ref text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  approved_by  uuid,
  approved_at  timestamptz,
  paid_at      timestamptz
);

CREATE TABLE partner_earnings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  invoice_id   uuid NOT NULL UNIQUE REFERENCES subscription_invoices(id),
  kind         text NOT NULL CHECK (kind IN ('subscription', 'setup')),
  base_kes     int NOT NULL,
  pct          numeric(5,2) NOT NULL,
  amount_kes   int NOT NULL,
  earned_at    timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'paid', 'reversed')),
  payout_id    uuid REFERENCES partner_payouts(id)
);
CREATE INDEX partner_earnings_partner ON partner_earnings (partner_id, earned_at);

-- A confirmed subscription payment moves paid-until; a setup fee does not.
CREATE OR REPLACE FUNCTION app_plan_paid(p_invoice uuid) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid; v_cycles int; v_months int; v_from date; v_to date; v_today date;
BEGIN
  SELECT tenant_id, cycles INTO v_t, v_cycles FROM subscription_invoices
  WHERE id = p_invoice AND status = 'paid' AND kind = 'subscription';
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

-- The partner's share of a paid invoice, at the partner's rate on the day it was paid. Once per invoice; nothing for
-- clubs NAVAC sells directly, for rates not set, or (subscriptions) past the agreed number of months.
CREATE FUNCTION app_record_earning(p_invoice uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; t record; v_pct numeric; v_first timestamptz; v_amt int;
BEGIN
  SELECT i.id, i.tenant_id, i.kind, i.amount_kes, i.paid_at, c.partner_id INTO v
  FROM subscription_invoices i JOIN tenants c ON c.id = i.tenant_id
  WHERE i.id = p_invoice AND i.status = 'paid';
  IF v.id IS NULL OR v.partner_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO t FROM partner_terms WHERE partner_id = v.partner_id;
  IF t.partner_id IS NULL THEN RETURN 0; END IF;
  v_pct := CASE v.kind WHEN 'setup' THEN t.setup_pct ELSE t.sub_pct END;
  IF coalesce(v_pct, 0) <= 0 THEN RETURN 0; END IF;
  IF v.kind = 'subscription' AND t.sub_months IS NOT NULL THEN
    SELECT min(paid_at) INTO v_first FROM subscription_invoices
    WHERE tenant_id = v.tenant_id AND kind = 'subscription' AND status = 'paid';
    IF v.paid_at >= v_first + make_interval(months => t.sub_months) THEN RETURN 0; END IF;
  END IF;
  -- One setup share per club, even if the owner somehow paid the setup fee twice (NAVAC refunds the extra).
  IF v.kind = 'setup' AND EXISTS (SELECT 1 FROM partner_earnings WHERE tenant_id = v.tenant_id AND kind = 'setup') THEN
    RETURN 0;
  END IF;
  v_amt := round(v.amount_kes * v_pct / 100);
  IF v_amt <= 0 THEN RETURN 0; END IF;
  INSERT INTO partner_earnings (partner_id, tenant_id, invoice_id, kind, base_kes, pct, amount_kes, earned_at, available_at)
  VALUES (v.partner_id, v.tenant_id, v.id, v.kind, v.amount_kes, v_pct, v_amt, v.paid_at,
          v.paid_at + make_interval(days => t.hold_days))
  ON CONFLICT (invoice_id) DO NOTHING;
  RETURN v_amt;
END $$;

-- Which partner's money a login may see: NAVAC admins see every partner (null), a partner admin sees their own
-- company; everyone else (technicians, NAVAC support) sees no money at all.
CREATE FUNCTION app_money_scope(p_staff uuid) RETURNS TABLE (allowed boolean, partner_id uuid, platform boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.role = 'partner_admin', s.partner_id, s.role = 'partner_admin' AND s.partner_id IS NULL
  FROM staff_users s WHERE s.id = p_staff AND s.active
$$;

CREATE FUNCTION app_partner_earnings(p_staff uuid)
RETURNS TABLE (tenant_id uuid, club text, partner text, kind text, base_kes int, pct numeric, amount_kes int,
               earned_at timestamptz, available_at timestamptz, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.tenant_id, c.name, p.name, e.kind, e.base_kes, e.pct, e.amount_kes, e.earned_at, e.available_at, e.status
  FROM partner_earnings e JOIN tenants c ON c.id = e.tenant_id JOIN partners p ON p.id = e.partner_id
  JOIN app_money_scope(p_staff) m ON m.allowed AND (m.platform OR m.partner_id = e.partner_id)
  ORDER BY e.earned_at
$$;

CREATE FUNCTION app_partner_payouts(p_staff uuid)
RETURNS TABLE (id uuid, partner text, statement_no text, gross_kes int, wht_kes int, net_kes int, status text,
               method text, sent_to text, created_at timestamptz, paid_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, p.name, o.statement_no, o.gross_kes, o.wht_kes, o.net_kes, o.status, o.method, o.sent_to, o.created_at,
         o.paid_at
  FROM partner_payouts o JOIN partners p ON p.id = o.partner_id
  JOIN app_money_scope(p_staff) m ON m.allowed AND (m.platform OR m.partner_id = o.partner_id)
  ORDER BY o.created_at DESC
$$;

-- Terms: a partner admin reads their own; NAVAC reads all (and every partner, even without terms yet).
CREATE FUNCTION app_partner_terms(p_staff uuid)
RETURNS TABLE (partner_id uuid, partner text, setup_pct numeric, sub_pct numeric, sub_months int, hold_days int,
               wht_pct numeric, payout_method text, payout_to text, kra_pin text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, t.setup_pct, t.sub_pct, t.sub_months, coalesce(t.hold_days, 14), coalesce(t.wht_pct, 0),
         t.payout_method, t.payout_to, t.kra_pin
  FROM partners p LEFT JOIN partner_terms t ON t.partner_id = p.id
  JOIN app_money_scope(p_staff) m ON m.allowed AND (m.platform OR m.partner_id = p.id)
  ORDER BY p.name
$$;

CREATE FUNCTION app_platform_set_terms(p_staff uuid, p_partner uuid, p_setup numeric, p_sub numeric, p_months int,
                                       p_hold int, p_wht numeric, p_method text, p_to text, p_pin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  INSERT INTO partner_terms (partner_id, setup_pct, sub_pct, sub_months, hold_days, wht_pct, payout_method, payout_to,
                             kra_pin, updated_by)
  VALUES (p_partner, p_setup, p_sub, p_months, coalesce(p_hold, 14), coalesce(p_wht, 0), nullif(p_method, ''),
          nullif(trim(p_to), ''), nullif(upper(trim(p_pin)), ''), p_staff)
  ON CONFLICT (partner_id) DO UPDATE SET setup_pct = excluded.setup_pct, sub_pct = excluded.sub_pct,
    sub_months = excluded.sub_months, hold_days = excluded.hold_days, wht_pct = excluded.wht_pct,
    payout_method = excluded.payout_method, payout_to = excluded.payout_to, kra_pin = excluded.kra_pin,
    updated_by = excluded.updated_by, updated_at = now();
END $$;

-- What each club pays NAVAC (plan, setup fee and whether it is paid), for the partner's own clubs. No money for
-- technicians or NAVAC support.
CREATE FUNCTION app_partner_club_billing(p_staff uuid)
RETURNS TABLE (tenant_id uuid, fee_kes int, cycle text, paid_until date, setup_fee_kes int, setup_paid boolean,
               setup_invoiced_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, cp.fee_kes, cp.cycle, cp.paid_until, cp.setup_fee_kes,
         EXISTS (SELECT 1 FROM subscription_invoices i WHERE i.tenant_id = c.id AND i.kind = 'setup' AND i.status = 'paid'),
         (SELECT min(i.created_at) FROM subscription_invoices i WHERE i.tenant_id = c.id AND i.kind = 'setup')
  FROM app_partner_clubs(p_staff) c
  JOIN app_money_scope(p_staff) m ON m.allowed
  LEFT JOIN club_plans cp ON cp.tenant_id = c.id
$$;

-- NAVAC only: what flowed through NAVAC in a window (member payments through the gateway, cash at desks, what clubs
-- paid NAVAC, SMS sold). Never callable by a partner.
CREATE FUNCTION app_platform_revenue(p_staff uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (gateway_kes bigint, cash_kes bigint, plans_kes bigint, setup_kes bigint, sms_kes bigint, sms_units bigint,
               shares_kes bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  RETURN QUERY SELECT
    (SELECT coalesce(sum(amount_kes), 0)::bigint FROM payments WHERE status = 'applied' AND channel <> 'cash'
       AND provider <> 'seed' AND paid_at >= p_from AND paid_at < p_to),
    (SELECT coalesce(sum(amount_kes), 0)::bigint FROM payments WHERE status = 'applied' AND channel = 'cash'
       AND paid_at >= p_from AND paid_at < p_to),
    (SELECT coalesce(sum(amount_kes), 0)::bigint FROM subscription_invoices WHERE status = 'paid' AND kind = 'subscription'
       AND paid_at >= p_from AND paid_at < p_to),
    (SELECT coalesce(sum(amount_kes), 0)::bigint FROM subscription_invoices WHERE status = 'paid' AND kind = 'setup'
       AND paid_at >= p_from AND paid_at < p_to),
    (SELECT coalesce(sum(amount_kes), 0)::bigint FROM sms_topups WHERE status = 'completed'
       AND completed_at >= p_from AND completed_at < p_to),
    (SELECT coalesce(sum(units), 0)::bigint FROM sms_topups WHERE status = 'completed'
       AND completed_at >= p_from AND completed_at < p_to),
    (SELECT coalesce(sum(amount_kes), 0)::bigint FROM partner_earnings WHERE status <> 'reversed'
       AND earned_at >= p_from AND earned_at < p_to);
END $$;

-- NAVAC sets the setup fee alongside the plan.
DROP FUNCTION app_platform_set_plan(uuid, uuid, text, int, text, date, text, text);
CREATE FUNCTION app_platform_set_plan(p_staff uuid, p_tenant uuid, p_name text, p_fee int, p_cycle text,
                                      p_paid_until date, p_phone text, p_email text, p_setup int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  INSERT INTO club_plans (tenant_id, plan_name, fee_kes, cycle, paid_until, billing_phone, billing_email, setup_fee_kes,
                          updated_by)
  VALUES (p_tenant, coalesce(nullif(trim(p_name), ''), 'Lango'), p_fee, p_cycle, p_paid_until, nullif(p_phone, ''),
          nullif(p_email, ''), p_setup, p_staff)
  ON CONFLICT (tenant_id) DO UPDATE SET plan_name = excluded.plan_name, fee_kes = excluded.fee_kes,
    cycle = excluded.cycle, paid_until = excluded.paid_until, billing_phone = excluded.billing_phone,
    billing_email = excluded.billing_email, setup_fee_kes = excluded.setup_fee_kes, updated_by = excluded.updated_by,
    updated_at = now();
  INSERT INTO audit_log (tenant_id, actor, action, data)
  VALUES (p_tenant, p_staff::text, 'billing.plan_set', jsonb_build_object('plan', p_name, 'fee', p_fee, 'cycle', p_cycle,
          'paidUntil', p_paid_until, 'setupFee', p_setup));
END $$;
