-- Sale lines copied from older payments (0014) had no dates: take them from the entitlements each payment created,
-- so "due this week" and member histories also cover payments made before services existed.
UPDATE payment_lines l SET starts_at = e.starts, ends_at = e.ends
FROM (SELECT source_id, min(starts_at) AS starts, max(ends_at) AS ends FROM entitlements
      WHERE source = 'payment' GROUP BY source_id) e
WHERE l.ends_at IS NULL AND e.source_id = l.payment_id;
