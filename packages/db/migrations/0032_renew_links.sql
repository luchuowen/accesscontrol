-- Renew links in reminder SMS (5 Oct 2026): a short code that opens a pay-only screen for one member's renewal,
-- without the SMS sign-in code. It can only start an M-Pesa prompt to the member's own phone; it shows no
-- details beyond the first name and member number, and it expires (48 hours).
CREATE TABLE renew_links (
  code text PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9]{10}$'),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX renew_links_member ON renew_links (member_id, expires_at);
ALTER TABLE renew_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE renew_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON renew_links
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The link arrives without a club, so the lookup crosses clubs; it returns only which club and member it is for.
CREATE FUNCTION app_renew_link(p_code text)
RETURNS TABLE (tenant_id uuid, member_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.tenant_id, r.member_id FROM renew_links r
  WHERE p_code ~ '^[A-Za-z0-9]{10}$' AND r.code = p_code AND r.expires_at > now()
$$;
REVOKE EXECUTE ON FUNCTION app_renew_link(text) FROM PUBLIC;
