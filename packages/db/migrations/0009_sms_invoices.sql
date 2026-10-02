-- SMS credit purchases are billed by NAVAC: each one gets an invoice number (also the M-Pesa account reference,
-- so NAVAC's TaifaPay statement shows exactly which club bought what) and becomes a receipt once paid.
CREATE SEQUENCE sms_invoice_seq;
ALTER TABLE sms_topups ADD COLUMN invoice_no text;
UPDATE sms_topups SET invoice_no = 'LSMS-' || lpad(nextval('sms_invoice_seq')::text, 5, '0') WHERE invoice_no IS NULL;
ALTER TABLE sms_topups ALTER COLUMN invoice_no SET DEFAULT 'LSMS-' || lpad(nextval('sms_invoice_seq')::text, 5, '0');
ALTER TABLE sms_topups ALTER COLUMN invoice_no SET NOT NULL;
CREATE UNIQUE INDEX sms_topups_invoice ON sms_topups (invoice_no);
-- The M-Pesa receipt code (e.g. TJ12ABC3XY) when TaifaPay reports one.
ALTER TABLE sms_topups ADD COLUMN receipt_ref text;
