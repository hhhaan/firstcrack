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
  p_lines jsonb
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'platformOrderId', p_platform_order_id,
    'status', p_status,
    'orderedAt', p_ordered_at,
    'buyerName', null,
    'currency', 'KRW',
    'totalAmount', p_total_amount,
    'raw', '{}'::jsonb,
    'lines', p_lines
  );
$$;
