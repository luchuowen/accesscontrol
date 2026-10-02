-- Communications (2 Oct 2026): one inbox for SMS, WhatsApp and email with members and anyone else who writes to
-- the club. Channels are connected per club from the partner console (NAVAC or the club's partner); the club only
-- reads and replies. SMS stays in sms_messages (Source Code is send-only); WhatsApp and email messages are stored
-- here. inbox.reply lets front desk staff answer without managing club-wide messaging.

CREATE TABLE comm_channels (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,   -- not secret: WhatsApp phone number id and number shown, email from name
  secret text,                                 -- encrypted JSON: WhatsApp access token and app secret
  routing_token text UNIQUE,                   -- WhatsApp webhook address
  verify_token text,                           -- WhatsApp webhook verification
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  address text NOT NULL,                       -- 2547XXXXXXXX for SMS and WhatsApp, lower-case email address
  name text,
  member_id uuid REFERENCES members(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  unread int NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  last_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, address)
);
CREATE INDEX conversations_recent ON conversations (tenant_id, last_at DESC);

CREATE TABLE comm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  body text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  provider_ref text,
  error text,
  staff_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comm_messages_thread ON comm_messages (conversation_id, created_at);
CREATE UNIQUE INDEX comm_messages_once ON comm_messages (tenant_id, provider_ref) WHERE provider_ref IS NOT NULL;

-- Staff SMS replies are sent like any other club SMS, tagged with their conversation.
ALTER TABLE sms_messages ADD COLUMN conversation_id uuid REFERENCES conversations(id);
ALTER TABLE sms_messages ADD COLUMN staff_name text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comm_channels', 'conversations', 'comm_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                   WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Who may reply: owner, admin, manager and front desk by default.
INSERT INTO role_permissions (role, perm) VALUES
  ('owner', 'inbox.reply'), ('admin', 'inbox.reply'), ('manager', 'inbox.reply'), ('reception', 'inbox.reply')
ON CONFLICT DO NOTHING;

-- Webhooks arrive without a club: find the WhatsApp channel by the token in its address.
CREATE FUNCTION app_channel_by_token(p_token text)
RETURNS TABLE (tenant_id uuid, config jsonb, secret text, verify_token text, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.tenant_id, c.config, c.secret, c.verify_token, c.enabled FROM comm_channels c
  WHERE c.channel = 'whatsapp' AND c.routing_token = p_token AND length(p_token) >= 24
$$;

-- Partner console: connect or change a club's channel. Partner admins for their own clubs, NAVAC for all.
-- A null secret keeps the stored one. Tokens are made once and kept.
CREATE FUNCTION app_partner_set_channel(p_staff uuid, p_tenant uuid, p_channel text, p_enabled boolean,
                                        p_config jsonb, p_secret text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  SELECT s.name INTO v_name FROM staff_users s WHERE s.id = p_staff AND s.active AND s.role = 'partner_admin';
  IF v_name IS NULL OR NOT EXISTS (SELECT 1 FROM app_partner_clubs(p_staff) c WHERE c.id = p_tenant) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  INSERT INTO comm_channels (tenant_id, channel, enabled, config, secret, routing_token, verify_token, updated_by)
  VALUES (p_tenant, p_channel, p_enabled, coalesce(p_config, '{}'::jsonb), p_secret,
          CASE WHEN p_channel = 'whatsapp' THEN encode(gen_random_bytes(18), 'hex') END,
          CASE WHEN p_channel = 'whatsapp' THEN encode(gen_random_bytes(12), 'hex') END, v_name)
  ON CONFLICT (tenant_id, channel) DO UPDATE SET
    enabled = excluded.enabled, config = excluded.config,
    secret = coalesce(excluded.secret, comm_channels.secret),
    updated_by = excluded.updated_by, updated_at = now();
  INSERT INTO audit_log (tenant_id, actor, action, data)
  VALUES (p_tenant, v_name, 'channel.saved', jsonb_build_object('channel', p_channel, 'enabled', p_enabled));
END $$;

-- Partner console: what each club has connected (never the secret itself).
CREATE FUNCTION app_partner_channels(p_staff uuid, p_tenant uuid)
RETURNS TABLE (channel text, enabled boolean, config jsonb, has_secret boolean, routing_token text,
               verify_token text, updated_by text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.channel, c.enabled, c.config, c.secret IS NOT NULL, c.routing_token, c.verify_token, c.updated_by, c.updated_at
  FROM comm_channels c
  WHERE c.tenant_id = p_tenant AND EXISTS (SELECT 1 FROM app_partner_clubs(p_staff) x WHERE x.id = p_tenant)
$$;
