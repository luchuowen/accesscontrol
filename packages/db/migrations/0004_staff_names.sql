-- Names of the current tenant's staff, so reports can show who recorded a cash payment (no emails or hashes).
CREATE FUNCTION app_staff_names()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name FROM staff_users s
  WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
REVOKE EXECUTE ON FUNCTION app_staff_names() FROM PUBLIC;
