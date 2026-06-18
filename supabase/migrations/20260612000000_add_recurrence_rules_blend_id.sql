-- Add blend_id column to recurrence_rules table
-- This enables recurring batches to track blend assignments

ALTER TABLE recurrence_rules
  ADD COLUMN blend_id uuid REFERENCES blends(id) ON DELETE SET NULL;
