-- Deleting a service (2 Oct 2026): a service nobody ever bought is removed outright; one with sales history is
-- marked deleted instead, so past payments keep their record and anyone already paid keeps access until their date.
ALTER TABLE services ADD COLUMN deleted_at timestamptz;
