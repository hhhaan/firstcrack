-- Add recurrence rule (RRULE) support to roast_plan_batches
-- RFC 5545 compliance via rrule TEXT field and group ID for grouping related batches

ALTER TABLE roast_plan_batches
ADD COLUMN IF NOT EXISTS rrule TEXT,
ADD COLUMN IF NOT EXISTS recurrence_group_id UUID;

COMMENT ON COLUMN roast_plan_batches.rrule IS 'RFC 5545 RRULE string (e.g. FREQ=WEEKLY;INTERVAL=2 for biweekly). Null means no recurrence.';
COMMENT ON COLUMN roast_plan_batches.recurrence_group_id IS 'UUID grouping all batches created from the same recurrence rule. Null for single batches.';
