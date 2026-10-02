-- Team seats count everyone in the club, the owner included (3 Oct 2026): a 5-seat club is the owner plus four.
CREATE OR REPLACE FUNCTION app_club_seats(p_tenant uuid) RETURNS TABLE (used int, cap int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int, 5 FROM club_memberships
  WHERE tenant_id = p_tenant AND removed_at IS NULL
$$;
