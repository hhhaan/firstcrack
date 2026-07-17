-- Phase 4: outbound dispatch records + confirmed via inbound sync

CREATE TABLE order_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES sales_channel_connections(id) ON DELETE CASCADE,
  carrier         text NOT NULL,
  tracking_number text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
  attempt_count   integer NOT NULL DEFAULT 0,
  last_error      text,
  line_results    jsonb,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  confirmed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One active dispatch row per order (retry reuses the same row)
CREATE UNIQUE INDEX order_dispatches_active_unique ON order_dispatches(order_id);

CREATE INDEX order_dispatches_user_idx ON order_dispatches(user_id);
CREATE INDEX order_dispatches_status_idx ON order_dispatches(status)
  WHERE status IN ('pending', 'sent', 'failed');

ALTER TABLE order_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own dispatches" ON order_dispatches
  FOR SELECT USING (auth.uid() = user_id);

GRANT SELECT ON order_dispatches TO authenticated;
-- INSERT/UPDATE/DELETE: service_role only (Edge Functions)
