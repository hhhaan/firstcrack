-- Remove legacy inventory system replaced by bean_stock_events event-sourcing.
-- bean_inventory_logs: superseded by bean_stock_events
-- beans.stock_grams: superseded by SUM(delta_grams) from bean_stock_events

DROP TABLE IF EXISTS bean_inventory_logs;

ALTER TABLE beans DROP COLUMN IF EXISTS stock_grams;
