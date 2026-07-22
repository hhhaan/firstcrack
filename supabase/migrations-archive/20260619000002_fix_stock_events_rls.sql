-- Fix RLS: add bean ownership check to prevent cross-user stock manipulation.
-- The original FOR ALL USING only validates user_id = auth.uid(), allowing a user
-- to insert events for another user's bean by setting bean_id to a foreign bean_id.

DROP POLICY IF EXISTS "users see own stock events" ON bean_stock_events;

CREATE POLICY "users see own stock events" ON bean_stock_events
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM beans
            WHERE beans.id = bean_stock_events.bean_id
              AND beans.user_id = auth.uid()
        )
    );
