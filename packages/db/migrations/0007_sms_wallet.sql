-- SMS resale: each club has its own sender ID and price (set by the platform), a prepaid SMS wallet,
-- and buys credit by M-Pesa through the platform's (NAVAC's) TaifaPay account.

-- Set by the platform only (clubs can read their own row).
CREATE TABLE tenant_sms (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  sender text,                          -- null = platform default sender
  price_kes numeric(8,2),               -- per SMS unit; null = platform default price
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every credit and debit, in SMS units. Balance = sum(units).
CREATE TABLE sms_ledger (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  units int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('topup', 'send', 'grant', 'adjust')),
  ref text,
  amount_kes numeric(12,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_ledger_tenant ON sms_ledger (tenant_id, created_at);
CREATE UNIQUE INDEX sms_ledger_once ON sms_ledger (tenant_id, kind, ref) WHERE ref IS NOT NULL;

-- M-Pesa purchases of SMS credit (paid to the platform's TaifaPay account).
CREATE TABLE sms_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  amount_kes int NOT NULL CHECK (amount_kes >= 10),
  price_kes numeric(8,2) NOT NULL,
  units int NOT NULL CHECK (units > 0),
  phone text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('manual', 'auto')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  provider_ref text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX sms_topups_pending ON sms_topups (status, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_sms','sms_ledger','sms_topups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                   WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Platform admin: set a club's sender ID and price.
CREATE FUNCTION app_platform_set_club_sms(p_staff uuid, p_tenant uuid, p_sender text, p_price numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  INSERT INTO tenant_sms (tenant_id, sender, price_kes, updated_at) VALUES (p_tenant, nullif(p_sender, ''), p_price, now())
  ON CONFLICT (tenant_id) DO UPDATE SET sender = excluded.sender, price_kes = excluded.price_kes, updated_at = now();
END $$;

-- Platform admin: grant or correct SMS units (e.g. free starter credit), always with a note.
CREATE FUNCTION app_platform_grant_sms(p_staff uuid, p_tenant uuid, p_units int, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  IF p_note IS NULL OR length(trim(p_note)) < 3 THEN RAISE EXCEPTION 'a note is required'; END IF;
  INSERT INTO sms_ledger (tenant_id, units, kind, note) VALUES (p_tenant, p_units, 'grant', p_note);
END $$;

-- Platform view across all clubs: sender, price, balance, 30-day usage and sales.
CREATE FUNCTION app_platform_sms_clubs(p_staff uuid)
RETURNS TABLE (tenant_id uuid, name text, slug text, sender text, price_kes numeric, balance bigint,
               sent_30d bigint, sold_kes_30d numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, t.slug, ts.sender, ts.price_kes,
    coalesce((SELECT sum(units) FROM sms_ledger l WHERE l.tenant_id = t.id), 0),
    coalesce((SELECT -sum(units) FROM sms_ledger l WHERE l.tenant_id = t.id AND l.kind = 'send' AND l.created_at > now() - interval '30 days'), 0),
    coalesce((SELECT sum(amount_kes) FROM sms_ledger l WHERE l.tenant_id = t.id AND l.kind = 'topup' AND l.created_at > now() - interval '30 days'), 0)
  FROM tenants t LEFT JOIN tenant_sms ts ON ts.tenant_id = t.id
  WHERE app_is_platform(p_staff)
  ORDER BY t.name
$$;

-- Platform view of people who can sign in at partner level (NAVAC + installers such as John).
CREATE FUNCTION app_platform_partners(p_staff uuid)
RETURNS TABLE (id uuid, name text, email text, partner text, active boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, coalesce(p.name, 'NAVAC (platform)'), s.active
  FROM staff_users s LEFT JOIN partners p ON p.id = s.partner_id
  WHERE s.role = 'partner_admin' AND app_is_platform(p_staff)
  ORDER BY s.partner_id NULLS FIRST, s.name
$$;

CREATE FUNCTION app_platform_set_partner_active(p_staff uuid, p_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  IF p_id = p_staff THEN RAISE EXCEPTION 'cannot change your own account'; END IF;
  UPDATE staff_users SET active = p_active WHERE id = p_id AND role = 'partner_admin';
END $$;

-- Top-ups for the poller: pending purchases across clubs (the platform TaifaPay account is shared).
CREATE FUNCTION app_pending_topups()
RETURNS TABLE (id uuid, tenant_id uuid, provider_ref text, amount_kes int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, tenant_id, provider_ref, amount_kes FROM sms_topups
  WHERE status = 'pending' AND provider_ref IS NOT NULL
    AND created_at > now() - interval '24 hours' AND created_at < now() - interval '30 seconds'
  ORDER BY created_at LIMIT 50
$$;

-- Platform admin: add a partner-level login (e.g. an installer company), new partner created by name if needed.
CREATE FUNCTION app_platform_add_partner(p_staff uuid, p_partner_name text, p_name text, p_email text, p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid; v_id uuid;
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  SELECT id INTO v_partner FROM partners WHERE lower(name) = lower(trim(p_partner_name)) LIMIT 1;
  IF v_partner IS NULL THEN INSERT INTO partners (name) VALUES (trim(p_partner_name)) RETURNING id INTO v_partner; END IF;
  INSERT INTO staff_users (email, name, role, password_hash, partner_id, active)
    VALUES (lower(p_email), p_name, 'partner_admin', p_hash, v_partner, true) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION app_platform_add_partner(uuid, text, text, text, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION app_platform_set_club_sms(uuid, uuid, text, numeric), app_platform_grant_sms(uuid, uuid, int, text),
  app_platform_sms_clubs(uuid), app_platform_partners(uuid), app_platform_set_partner_active(uuid, uuid, boolean),
  app_pending_topups() FROM PUBLIC;
