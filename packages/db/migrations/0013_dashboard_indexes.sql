-- Dashboard (2 Oct 2026): the owner dashboard re-reads every 30 seconds while open, so its queries must stay on
-- indexes as door events, payments and plans pile up. Each index matches one dashboard question; RLS adds
-- tenant_id = current club to every query, so tenant_id leads.

-- In the club now, busiest hour, today's entries: granted door events by time.
CREATE INDEX IF NOT EXISTS access_events_tenant_at ON access_events (tenant_id, at) WHERE granted;
-- Not seen 14+ days: a member's last granted entry.
CREATE INDEX IF NOT EXISTS access_events_member_at ON access_events (tenant_id, member_no, at) WHERE granted;
-- Money in, revenue, top plans: applied payments by time.
CREATE INDEX IF NOT EXISTS payments_tenant_paid ON payments (tenant_id, paid_at) WHERE status = 'applied';
-- A member's last plan (ending soon, expected renewals) and first payment (joined).
CREATE INDEX IF NOT EXISTS payments_member_paid ON payments (member_id, paid_at) WHERE status = 'applied';
-- Unmatched payments waiting for review.
CREATE INDEX IF NOT EXISTS payments_unmatched ON payments (tenant_id) WHERE status = 'unmatched';
-- Active members, renewals, ending soon: entitlements by end time.
CREATE INDEX IF NOT EXISTS entitlements_tenant_ends ON entitlements (tenant_id, ends_at);
