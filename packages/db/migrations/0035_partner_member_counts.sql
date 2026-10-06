-- Partner console member counts (6 Oct 2026): "active" and "on record" now count the same people. Both leave out
-- day-pass wristbands (member numbers 11001–11999) and archived members, so active can never exceed on record.
CREATE OR REPLACE FUNCTION app_partner_stats(p_staff uuid)
RETURNS TABLE (
  tenant_id uuid, members int, active_members int, via_taifapay bigint, cash bigint, unmatched int,
  bridge_seen timestamptz, taifapay_env text, paybill text, till text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id,
    (SELECT count(*)::int FROM members m WHERE m.tenant_id = c.id AND m.status = 'active'
       AND m.member_no NOT BETWEEN 11001 AND 11999),
    (SELECT count(DISTINCT e.member_id)::int FROM entitlements e JOIN members m ON m.id = e.member_id
      WHERE e.tenant_id = c.id AND now() BETWEEN e.starts_at AND e.ends_at
        AND m.status = 'active' AND m.member_no NOT BETWEEN 11001 AND 11999),
    (SELECT coalesce(sum(amount_kes), 0) FROM payments p WHERE p.tenant_id = c.id AND p.status = 'applied'
       AND p.channel <> 'cash' AND p.provider <> 'seed' AND p.paid_at > now() - interval '30 days'),
    (SELECT coalesce(sum(amount_kes), 0) FROM payments p WHERE p.tenant_id = c.id AND p.status = 'applied'
       AND p.channel = 'cash' AND p.paid_at > now() - interval '30 days'),
    (SELECT count(*)::int FROM payments p WHERE p.tenant_id = c.id AND p.status = 'unmatched'),
    (SELECT max(b.last_seen_at) FROM bridges b WHERE b.tenant_id = c.id),
    (SELECT ts.data->'taifapay'->>'env' FROM tenant_settings ts WHERE ts.tenant_id = c.id),
    (SELECT ts.data->'channels'->>'paybill' FROM tenant_settings ts WHERE ts.tenant_id = c.id),
    (SELECT ts.data->'channels'->>'till' FROM tenant_settings ts WHERE ts.tenant_id = c.id)
  FROM app_partner_clubs(p_staff) c
$$;
