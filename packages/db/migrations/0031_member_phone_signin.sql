-- Members sign in to the portal with their phone number and an SMS code (no club code, no member number).
-- The phone may belong to active members at more than one club, so the lookup crosses clubs; it returns only
-- what sign-in needs and is matched on the last nine digits (07.., +2547.., 2547.. all agree).
CREATE INDEX members_phone9 ON members ((right(regexp_replace(phone, '\D', '', 'g'), 9))) WHERE status = 'active';

CREATE FUNCTION app_members_by_phone(p_msisdn text)
RETURNS TABLE (tenant_id uuid, club text, member_id uuid, member_no int, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id, t.name, m.id, m.member_no, m.phone
  FROM members m JOIN tenants t ON t.id = m.tenant_id
  WHERE p_msisdn ~ '^254[17][0-9]{8}$'
    AND m.status = 'active'
    AND right(regexp_replace(m.phone, '\D', '', 'g'), 9) = right(p_msisdn, 9)
  ORDER BY t.name, m.member_no
  LIMIT 10
$$;
REVOKE EXECUTE ON FUNCTION app_members_by_phone(text) FROM PUBLIC;
