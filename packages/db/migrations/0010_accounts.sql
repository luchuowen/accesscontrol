-- Section 1 · Sign-in and accounts: server-side sessions, single-use links (invite, reset), sign-in codes,
-- remembered devices, and the email delivery log. Only hashes of tokens are stored.

ALTER TABLE staff_users ADD COLUMN phone text;
ALTER TABLE staff_users ADD COLUMN invited_by uuid REFERENCES staff_users(id);
ALTER TABLE staff_users ADD COLUMN invited_at timestamptz;
ALTER TABLE staff_users ADD COLUMN accepted_at timestamptz;
-- Everyone who exists today has already set a password.
UPDATE staff_users SET accepted_at = created_at WHERE accepted_at IS NULL;

-- Sessions: the cookie holds a random token; the server keeps its hash, so sign-out and removal are immediate.
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  staff_id uuid NOT NULL REFERENCES staff_users(id),
  tenant_id uuid REFERENCES tenants(id),       -- the club being worked in (partners switch clubs)
  acting_role text,                             -- partner opening a club acts as owner
  idle_minutes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  ip text,
  user_agent text
);
CREATE INDEX auth_sessions_staff ON auth_sessions (staff_id) WHERE revoked_at IS NULL;

-- Single-use links and codes: invite, password reset, sign-in code.
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('invite', 'reset', 'signin_code')),
  token_hash text NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff_users(id),
  created_by uuid REFERENCES staff_users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_tokens_hash ON auth_tokens (token_hash);
CREATE INDEX auth_tokens_staff ON auth_tokens (staff_id, kind, created_at);

-- Remembered devices skip the sign-in code until they expire.
CREATE TABLE trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  staff_id uuid NOT NULL REFERENCES staff_users(id),
  expires_at timestamptz NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every email Lango sends, with its real outcome (Resend webhooks update it).
CREATE TABLE email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  to_email text NOT NULL,
  subject text NOT NULL,
  kind text NOT NULL,
  idempotency_key text UNIQUE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped')),
  provider_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_messages_provider ON email_messages (provider_id);
CREATE INDEX email_messages_recent ON email_messages (created_at DESC);

-- Directory reads without the password hash.
CREATE FUNCTION app_staff_by_email(p_email text)
RETURNS TABLE (id uuid, name text, email text, phone text, role text, tenant_id uuid, partner_id uuid,
               active boolean, accepted_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, s.phone, s.role, s.tenant_id, s.partner_id, s.active, s.accepted_at
  FROM staff_users s WHERE s.email = lower(trim(p_email))
$$;

CREATE FUNCTION app_staff_get(p_id uuid)
RETURNS TABLE (id uuid, name text, email text, phone text, role text, tenant_id uuid, partner_id uuid,
               active boolean, accepted_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, s.phone, s.role, s.tenant_id, s.partner_id, s.active, s.accepted_at
  FROM staff_users s WHERE s.id = p_id
$$;

-- An invitation creates the account switched off, with no usable password, until it is accepted.
-- Who may invite whom: club owners invite into their own club; partner admins invite the owner of a club
-- they manage; platform admins invite partner logins (and anyone).
CREATE FUNCTION app_invite_staff(p_inviter uuid, p_email text, p_name text, p_phone text, p_role text,
                                 p_tenant uuid, p_partner uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv staff_users; v_id uuid; v_platform boolean;
BEGIN
  SELECT * INTO v_inv FROM staff_users WHERE id = p_inviter AND active;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'inviter not active'; END IF;
  v_platform := v_inv.role = 'partner_admin' AND v_inv.partner_id IS NULL;
  IF p_role = 'partner_admin' THEN
    IF NOT v_platform THEN RAISE EXCEPTION 'only NAVAC adds partner logins'; END IF;
    IF p_tenant IS NOT NULL THEN RAISE EXCEPTION 'partner logins have no club'; END IF;
  ELSIF p_role IN ('owner', 'manager', 'reception', 'accountant') THEN
    IF p_tenant IS NULL THEN RAISE EXCEPTION 'club required'; END IF;
    IF NOT (
      v_platform
      OR (v_inv.role = 'owner' AND v_inv.tenant_id = p_tenant)
      OR (v_inv.role = 'partner_admin' AND p_role = 'owner'
          AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant AND t.partner_id = v_inv.partner_id))
    ) THEN RAISE EXCEPTION 'not allowed to invite into this club'; END IF;
  ELSE
    RAISE EXCEPTION 'bad role';
  END IF;
  INSERT INTO staff_users (tenant_id, partner_id, email, name, phone, role, password_hash, active, invited_by, invited_at)
  VALUES (p_tenant, CASE WHEN p_role = 'partner_admin' THEN p_partner END, lower(trim(p_email)), p_name,
          nullif(p_phone, ''), p_role, 'invited$', false, p_inviter, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Accepting an invitation sets the password and switches the account on (once).
CREATE FUNCTION app_staff_accept(p_id uuid, p_hash text, p_name text, p_phone text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE staff_users SET password_hash = p_hash, name = coalesce(nullif(trim(p_name), ''), name),
         phone = coalesce(nullif(p_phone, ''), phone), active = true, accepted_at = now()
  WHERE id = p_id AND accepted_at IS NULL;
  RETURN FOUND;
END $$;

CREATE FUNCTION app_staff_set_phone(p_id uuid, p_phone text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE staff_users SET phone = nullif(p_phone, '') WHERE id = p_id
$$;

-- Who invited this person (for "your invitation was accepted" and "send me a new link").
CREATE FUNCTION app_staff_inviter(p_id uuid) RETURNS TABLE (name text, email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.name, i.email FROM staff_users s JOIN staff_users i ON i.id = s.invited_by WHERE s.id = p_id
$$;

-- Club team list now shows pending invitations and phones.
DROP FUNCTION app_tenant_staff();
CREATE FUNCTION app_tenant_staff()
RETURNS TABLE (id uuid, name text, email text, role text, active boolean, created_at timestamptz,
               phone text, accepted_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, s.role, s.active, s.created_at, s.phone, s.accepted_at FROM staff_users s
  WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND s.role <> 'partner_admin'
  ORDER BY s.created_at
$$;

-- Partner logins list shows pending invitations too.
DROP FUNCTION app_platform_partners(uuid);
CREATE FUNCTION app_platform_partners(p_staff uuid)
RETURNS TABLE (id uuid, name text, email text, partner text, active boolean, accepted_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.email, coalesce(p.name, 'NAVAC (platform)'), s.active, s.accepted_at
  FROM staff_users s LEFT JOIN partners p ON p.id = s.partner_id
  WHERE s.role = 'partner_admin' AND app_is_platform(p_staff)
  ORDER BY s.partner_id NULLS FIRST, s.name
$$;

-- A partner company by name (created if new), for partner invitations.
CREATE FUNCTION app_platform_partner_id(p_staff uuid, p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF NOT app_is_platform(p_staff) THEN RAISE EXCEPTION 'not a platform admin'; END IF;
  SELECT id INTO v FROM partners WHERE lower(name) = lower(trim(p_name)) LIMIT 1;
  IF v IS NULL THEN INSERT INTO partners (name) VALUES (trim(p_name)) RETURNING id INTO v; END IF;
  RETURN v;
END $$;

-- A club just created by a partner: its owner account waits for the emailed invitation.
CREATE FUNCTION app_club_owner_pending(p_staff uuid, p_tenant uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_partner_clubs(p_staff) c WHERE c.id = p_tenant) THEN
    RAISE EXCEPTION 'not your club';
  END IF;
  UPDATE staff_users SET active = false, password_hash = 'invited$', invited_by = p_staff, invited_at = now()
  WHERE tenant_id = p_tenant AND role = 'owner' AND accepted_at IS NULL RETURNING id INTO v;
  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION app_club_owner_pending(uuid, uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION app_staff_by_email(text), app_staff_get(uuid),
  app_invite_staff(uuid, text, text, text, text, uuid, uuid), app_staff_accept(uuid, text, text, text),
  app_staff_set_phone(uuid, text), app_staff_inviter(uuid), app_tenant_staff(), app_platform_partners(uuid),
  app_platform_partner_id(uuid, text) FROM PUBLIC;
