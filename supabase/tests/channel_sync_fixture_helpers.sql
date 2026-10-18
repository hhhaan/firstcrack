-- Shared pg_temp payloads for channel sync SQL fixtures (included via \ir from ledger_preservation / channel_orders_batch).
CREATE OR REPLACE FUNCTION pg_temp.channel_fixture_line(
  p_platform_line_id text,
  p_product_id uuid,
  p_quantity integer,
  p_title text DEFAULT 'Coffee',
  p_unit_price integer DEFAULT 1,
  p_line_status text DEFAULT 'active',
  p_platform_product_id text DEFAULT NULL,
  p_platform_variant_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'platformLineId', p_platform_line_id,
    'platformProductId', p_platform_product_id,
    'platformVariantId', p_platform_variant_id,
    'productId', p_product_id,
    'title', p_title,
    'quantity', p_quantity,
    'unitPrice', p_unit_price,
    'status', p_line_status
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.channel_fixture_order(
  p_platform_order_id text,
  p_status text,
  p_ordered_at text,
  p_total_amount integer,
  p_lines jsonb,
  p_buyer_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'platformOrderId', p_platform_order_id,
    'status', p_status,
    'orderedAt', p_ordered_at,
    'buyerName', p_buyer_name,
    'currency', 'KRW',
    'totalAmount', p_total_amount,
    'raw', '{}'::jsonb,
    'lines', p_lines
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.sync_single_line_order(
  p_owner uuid,
  p_connection uuid,
  p_platform_order_id text,
  p_header_status text,
  p_ordered_at text,
  p_total_amount integer,
  p_platform_line_id text,
  p_product_id uuid,
  p_quantity integer,
  p_unit_price integer,
  p_line_status text,
  p_buyer_name text DEFAULT NULL,
  p_title text DEFAULT 'Coffee'
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM sync_channel_orders_batch(
    p_owner,
    p_connection,
    jsonb_build_array(
      pg_temp.channel_fixture_order(
        p_platform_order_id,
        p_header_status,
        p_ordered_at,
        p_total_amount,
        jsonb_build_array(
          pg_temp.channel_fixture_line(
            p_platform_line_id,
            p_product_id,
            p_quantity,
            p_title,
            p_unit_price,
            p_line_status
          )
        ),
        p_buyer_name
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.insert_product_with_stock(
  p_product_id uuid,
  p_owner uuid,
  p_name text,
  p_sku text,
  p_stock_units integer,
  p_net_weight_grams integer DEFAULT 200
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO products(id, user_id, name, sku, net_weight_grams)
  VALUES (p_product_id, p_owner, p_name, p_sku, p_net_weight_grams);
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (p_owner, p_product_id, p_stock_units, 'roast_inbound');
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.sync_active_filter_snapshot(
  p_owner uuid,
  p_connection uuid,
  p_product_id uuid,
  p_order_status text,
  p_line_b_status text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM sync_channel_orders_batch(
    p_owner,
    p_connection,
    jsonb_build_array(
      pg_temp.channel_fixture_order(
        'active-filter-1',
        p_order_status,
        '2026-10-17T09:00:00Z',
        2,
        jsonb_build_array(
          pg_temp.channel_fixture_line('af-a', p_product_id, 1, 'A', 1, 'active'),
          pg_temp.channel_fixture_line('af-b', p_product_id, 1, 'B', 1, p_line_b_status)
        ),
        'A'
      )
    )
  );
END;
$$;
