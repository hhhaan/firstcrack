-- Inventory/production writes only. Existing grants remain read-only.
-- skip-grant-check: private receipts and dispatchers are not a public Data API.
GRANT CREATE ON SCHEMA private TO firstcrack_mcp_store;
ALTER TABLE private.mcp_grants DROP CONSTRAINT mcp_grants_scope_check;
ALTER TABLE private.mcp_grants ADD CONSTRAINT mcp_grants_scope_check
  CHECK (scope IN ('firstcrack:read', 'firstcrack:read firstcrack:write'));
ALTER TABLE private.mcp_authorizations ADD COLUMN scope text NOT NULL DEFAULT 'firstcrack:read'
  CHECK (scope IN ('firstcrack:read', 'firstcrack:read firstcrack:write'));

-- Preserve the existing PKCE, replay revocation and grant-first rotation implementation.
ALTER FUNCTION private.mcp_oauth(text, jsonb) RENAME TO mcp_oauth_read;
REVOKE ALL ON FUNCTION private.mcp_oauth_read(text, jsonb) FROM firstcrack_mcp_issuer;
CREATE FUNCTION private.mcp_oauth(action text, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result jsonb; requested text; stored_scope text; authorization_id uuid;
BEGIN
  requested := coalesce(p->>'scope', 'firstcrack:read');
  IF action = 'start' AND requested NOT IN ('firstcrack:read', 'firstcrack:read firstcrack:write') THEN
    RETURN jsonb_build_object('error', 'invalid_scope');
  END IF;
  IF action = 'refresh' AND p ? 'scope' THEN
    SELECT g.scope INTO stored_scope FROM private.mcp_grants g
      JOIN private.mcp_tokens t ON t.grant_id = g.id WHERE t.hash = p->>'source_hash';
    IF requested IS DISTINCT FROM stored_scope THEN RETURN jsonb_build_object('error', 'invalid_scope'); END IF;
  END IF;
  result := private.mcp_oauth_read(action, p);
  IF result ? 'error' THEN RETURN result; END IF;
  IF action = 'start' THEN
    UPDATE private.mcp_authorizations SET scope = requested WHERE id = (result->>'authorization_id')::uuid;
  ELSIF action = 'details' THEN
    SELECT scope INTO stored_scope FROM private.mcp_authorizations WHERE id = (p->>'authorization_id')::uuid;
    result := result || jsonb_build_object('scope', stored_scope);
  ELSIF action = 'approve' THEN
    authorization_id := (p->>'authorization_id')::uuid;
    IF p->'allow_write' = 'true'::jsonb THEN
      UPDATE private.mcp_grants g SET scope = a.scope FROM private.mcp_authorizations a
        WHERE a.id = authorization_id AND g.id = a.grant_id;
    END IF;
  ELSIF action IN ('exchange', 'refresh') THEN
    SELECT g.scope INTO stored_scope FROM private.mcp_grants g
      JOIN private.mcp_tokens t ON t.grant_id = g.id WHERE t.hash = p->>'access_hash';
    result := result || jsonb_build_object('scope', stored_scope);
  ELSIF action = 'grants' THEN
    SELECT jsonb_build_object('grants', coalesce(jsonb_agg(item || jsonb_build_object('scope', g.scope)), '[]'::jsonb))
      INTO result FROM jsonb_array_elements(result->'grants') item
      JOIN private.mcp_grants g ON g.id = (item->>'id')::uuid;
  END IF;
  RETURN result;
END $$;
ALTER FUNCTION private.mcp_oauth(text, jsonb) OWNER TO firstcrack_mcp_store;
REVOKE ALL ON FUNCTION private.mcp_oauth(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mcp_oauth(text, jsonb) TO firstcrack_mcp_issuer;

DO $$ BEGIN
  CREATE ROLE firstcrack_mcp_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  IF current_setting('server_version_num')::integer >= 160000 THEN
    EXECUTE format('GRANT firstcrack_mcp_writer TO %I WITH SET TRUE, INHERIT TRUE', current_user);
  ELSE
    EXECUTE format('GRANT firstcrack_mcp_writer TO %I', current_user);
  END IF;
END $$;
GRANT USAGE ON SCHEMA private, public TO firstcrack_mcp_writer;
GRANT CREATE ON SCHEMA private TO firstcrack_mcp_writer;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid),
  private.mcp_access(text, text, text) TO firstcrack_mcp_writer;

-- Hosted postgres cannot grant auth-schema USAGE to a custom role.
CREATE FUNCTION public.request_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
REVOKE ALL ON FUNCTION public.request_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_user_id() TO authenticated, service_role, firstcrack_mcp_writer;
DO $$ DECLARE signature text; definition text; expected integer; actual integer; BEGIN
  FOREACH signature IN ARRAY ARRAY['public.save_roast_op(jsonb,boolean,integer,integer,boolean)',
    'public.upsert_roasted_inbound(uuid,uuid,integer,boolean)'] LOOP
    expected := CASE WHEN signature LIKE 'public.save_roast_op%' THEN 3 ELSE 1 END;
    SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc
      WHERE oid = signature::regprocedure AND NOT prosecdef AND proowner = 'postgres'::regrole;
    actual := (length(definition) - length(replace(definition, 'auth.uid()', ''))) / length('auth.uid()');
    IF definition IS NULL OR actual <> expected THEN
      RAISE EXCEPTION 'Unexpected production identity lookup in %', signature;
    END IF;
    EXECUTE replace(definition, 'auth.uid()', 'public.request_user_id()');
  END LOOP;
END $$;
GRANT SELECT(id, plan) ON public.profiles TO firstcrack_mcp_writer;
CREATE POLICY mcp_writer_owner_plan ON public.profiles FOR SELECT TO firstcrack_mcp_writer
  USING (id = (auth.jwt()->>'firstcrack_workspace_owner_id')::uuid AND public.has_workspace_access(id));
GRANT SELECT ON public.beans, public.products, public.blends, public.blend_components,
  public.roast_sessions, public.roast_plan_batches, public.roast_day_plans, public.recurrence_rules,
  public.bean_stock_events, public.roasted_stock_events, public.product_stock_events TO firstcrack_mcp_writer;
GRANT INSERT ON public.roast_sessions, public.bean_stock_events, public.roasted_stock_events,
  public.product_stock_events TO firstcrack_mcp_writer;
GRANT UPDATE(delta_grams, is_estimate, created_at) ON public.roasted_stock_events TO firstcrack_mcp_writer;
GRANT UPDATE(created_at) ON public.product_stock_events TO firstcrack_mcp_writer;
GRANT EXECUTE ON FUNCTION public.save_roast_op(jsonb, boolean, integer, integer, boolean),
  public.upsert_roasted_inbound(uuid, uuid, integer, boolean), public.roast_deduction_blocked(uuid),
  public.insert_packaging_op(jsonb, jsonb) TO firstcrack_mcp_writer;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['beans', 'products', 'blends', 'roast_sessions', 'roast_day_plans',
    'recurrence_rules', 'bean_stock_events', 'roasted_stock_events', 'product_stock_events'] LOOP
    EXECUTE format('CREATE POLICY mcp_writer_scope ON public.%I AS RESTRICTIVE TO firstcrack_mcp_writer
      USING (user_id = (auth.jwt()->>''firstcrack_workspace_owner_id'')::uuid AND public.has_workspace_access(user_id))
      WITH CHECK (user_id = (auth.jwt()->>''firstcrack_workspace_owner_id'')::uuid AND public.has_workspace_access(user_id))', tab);
    EXECUTE format('CREATE POLICY mcp_writer_access ON public.%I TO firstcrack_mcp_writer
      USING (public.has_workspace_access(user_id)) WITH CHECK (public.has_workspace_access(user_id))', tab);
  END LOOP;
END $$;

-- Receipts outlive source deletion, grant revocation and request-ID changes.
CREATE TABLE private.inventory_productions (
  workspace_owner_id uuid NOT NULL,
  production_id uuid NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('roast', 'packaging')),
  legs text[] NOT NULL,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_owner_id, production_id)
);
ALTER TABLE private.inventory_productions OWNER TO firstcrack_mcp_store;
ALTER TABLE private.inventory_productions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.inventory_productions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.inventory_productions TO firstcrack_mcp_writer;
CREATE POLICY writer_receipt_scope ON private.inventory_productions FOR SELECT TO firstcrack_mcp_writer
  USING (workspace_owner_id = (auth.jwt()->>'firstcrack_workspace_owner_id')::uuid);
INSERT INTO private.inventory_productions(workspace_owner_id, production_id, kind, legs)
  SELECT user_id, id, 'roast', ARRAY['session'] FROM public.roast_sessions
  ON CONFLICT DO NOTHING;
INSERT INTO private.inventory_productions(workspace_owner_id, production_id, kind, legs)
  SELECT user_id, reference_id, 'roast', ARRAY['session'] FROM public.roasted_stock_events
  WHERE event_type = 'roast_inbound' AND reference_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO private.inventory_productions(workspace_owner_id, production_id, kind, legs)
  SELECT user_id, reference_id, 'packaging', ARRAY['product', 'roasted'] FROM public.product_stock_events
  WHERE event_type = 'roast_inbound' AND reference_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO private.inventory_productions(workspace_owner_id, production_id, kind, legs)
  SELECT user_id, reference_id, 'packaging', ARRAY['roasted'] FROM public.roasted_stock_events
  WHERE event_type = 'packaging' AND reference_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION private.remember_inventory_production() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE production uuid; category text; leg text;
BEGIN
  IF TG_TABLE_NAME = 'roast_sessions' THEN production := NEW.id; category := 'roast'; leg := 'session';
  ELSIF TG_TABLE_NAME = 'product_stock_events' AND NEW.event_type = 'roast_inbound' THEN
    production := NEW.reference_id; category := 'packaging'; leg := 'product';
  ELSIF TG_TABLE_NAME = 'roasted_stock_events' AND NEW.event_type = 'packaging' THEN
    production := NEW.reference_id; category := 'packaging'; leg := 'roasted';
  ELSE RETURN NEW;
  END IF;
  IF production IS NULL THEN RETURN NEW; END IF;
  INSERT INTO private.inventory_productions AS receipt(workspace_owner_id, production_id, kind, legs)
    VALUES (NEW.user_id, production, category, ARRAY[leg])
    ON CONFLICT (workspace_owner_id, production_id) DO UPDATE SET legs = receipt.legs || EXCLUDED.legs
      WHERE receipt.transaction_id = txid_current() AND receipt.kind = EXCLUDED.kind AND NOT leg = ANY(receipt.legs);
  IF NOT FOUND THEN RAISE EXCEPTION 'production_exists' USING ERRCODE = '23505'; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION private.remember_inventory_production() OWNER TO firstcrack_mcp_store;
REVOKE ALL ON FUNCTION private.remember_inventory_production() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER remember_inventory_production AFTER INSERT ON public.roast_sessions
  FOR EACH ROW EXECUTE FUNCTION private.remember_inventory_production();
CREATE TRIGGER remember_inventory_production AFTER INSERT ON public.product_stock_events
  FOR EACH ROW EXECUTE FUNCTION private.remember_inventory_production();
CREATE TRIGGER remember_inventory_production AFTER INSERT ON public.roasted_stock_events
  FOR EACH ROW EXECUTE FUNCTION private.remember_inventory_production();

-- Never wait for an inventory advisory lock while holding existing app/order row locks.
CREATE FUNCTION private.guard_inventory_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE old_row jsonb; new_row jsonb; owner_id uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'inventory_requires_read_committed' USING ERRCODE = '40001';
  END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  FOR owner_id IN SELECT DISTINCT value::uuid FROM unnest(ARRAY[old_row->>'user_id', new_row->>'user_id']) value
      WHERE value IS NOT NULL ORDER BY 1 LOOP
      IF NOT pg_try_advisory_xact_lock(hashtextextended('firstcrack.inventory:' || owner_id, 0)) THEN
        RAISE EXCEPTION 'inventory_busy' USING ERRCODE = '40001';
      END IF;
    END LOOP;
    IF TG_OP <> 'DELETE' THEN
      IF new_row->>'bean_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.beans WHERE id = (new_row->>'bean_id')::uuid AND user_id = NEW.user_id
      ) THEN RAISE EXCEPTION 'inventory_reference_owner_mismatch' USING ERRCODE = '23514'; END IF;
      IF new_row->>'blend_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.blends WHERE id = (new_row->>'blend_id')::uuid AND user_id = NEW.user_id
      ) THEN RAISE EXCEPTION 'inventory_reference_owner_mismatch' USING ERRCODE = '23514'; END IF;
      IF new_row->>'product_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.products WHERE id = (new_row->>'product_id')::uuid AND user_id = NEW.user_id
      ) THEN RAISE EXCEPTION 'inventory_reference_owner_mismatch' USING ERRCODE = '23514'; END IF;
      RETURN NEW;
    END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.guard_inventory_ledger() FROM PUBLIC, anon, authenticated;

-- Transition tables guard actual statement deltas, including deletes and conflict no-ops.
CREATE FUNCTION private.guard_inventory_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE changes text; change record; balance numeric;
BEGIN
  changes := CASE TG_OP
    WHEN 'INSERT' THEN 'SELECT to_jsonb(n) AS row, 1 AS sign FROM inserted n'
    WHEN 'DELETE' THEN 'SELECT to_jsonb(o) AS row, -1 AS sign FROM removed o'
    ELSE 'SELECT to_jsonb(n) AS row, 1 AS sign FROM inserted n UNION ALL SELECT to_jsonb(o), -1 FROM removed o' END;
  FOR change IN EXECUTE format('SELECT (row->>''user_id'')::uuid AS owner_id,
      CASE WHEN row ? ''product_id'' THEN ''product_id'' WHEN row->>''bean_id'' IS NOT NULL THEN ''bean_id'' ELSE ''blend_id'' END AS col,
      coalesce(row->>''product_id'',row->>''bean_id'',row->>''blend_id'')::uuid AS target
      FROM (%s) deltas GROUP BY 1,2,3 HAVING sum((row->>%L)::bigint * sign *
        CASE WHEN row->>''event_type'' = ''expected_inbound'' THEN 0 ELSE 1 END) < 0', changes, TG_ARGV[0]) LOOP
    EXECUTE format('SELECT coalesce(sum(%I),0) FROM public.%I WHERE user_id=$1 AND %I=$2
      AND event_type IS DISTINCT FROM ''expected_inbound''',
      TG_ARGV[0], TG_TABLE_NAME, change.col) INTO balance USING change.owner_id, change.target;
    IF balance < 0 THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = '23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.guard_inventory_balance() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE tab text; col text; BEGIN
  FOREACH tab IN ARRAY ARRAY['bean_stock_events', 'roasted_stock_events', 'product_stock_events'] LOOP
    col := CASE WHEN tab = 'product_stock_events' THEN 'delta_units' ELSE 'delta_grams' END;
    EXECUTE format('CREATE TRIGGER guard_inventory_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.guard_inventory_ledger(%L)', tab, col);
    EXECUTE format('CREATE TRIGGER guard_inventory_insert_balance AFTER INSERT ON public.%I
      REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION private.guard_inventory_balance(%L)', tab, col);
    EXECUTE format('CREATE TRIGGER guard_inventory_update_balance AFTER UPDATE ON public.%I
      REFERENCING OLD TABLE AS removed NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION private.guard_inventory_balance(%L)', tab, col);
    EXECUTE format('CREATE TRIGGER guard_inventory_delete_balance AFTER DELETE ON public.%I
      REFERENCING OLD TABLE AS removed FOR EACH STATEMENT EXECUTE FUNCTION private.guard_inventory_balance(%L)', tab, col);
  END LOOP;
END $$;

CREATE TABLE private.mcp_write_requests (
  workspace_owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  production_id uuid,
  tool text NOT NULL,
  arguments jsonb NOT NULL,
  result jsonb NOT NULL,
  actor_id uuid NOT NULL,
  client_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_owner_id, request_id),
  UNIQUE (workspace_owner_id, production_id)
);
ALTER TABLE private.mcp_write_requests OWNER TO firstcrack_mcp_writer;
ALTER TABLE private.mcp_write_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.mcp_write_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.mcp_write(token_hash text, expected_issuer text, expected_resource text, tool text, args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE proof jsonb; owner_id uuid; actor uuid; request uuid; production uuid; source_id uuid;
  amount integer; output integer; consumed bigint; operation_at timestamptz; allowed text[]; field text;
  cost numeric; product public.products%ROWTYPE; receipt private.mcp_write_requests%ROWTYPE;
  result jsonb; roasted_events jsonb := '[]'::jsonb; current_plan text; id_field text;
BEGIN
  proof := private.mcp_access(token_hash, expected_issuer, expected_resource);
  IF proof IS NULL THEN RETURN jsonb_build_object('error', 'invalid_token'); END IF;
  IF proof->>'scope' IS DISTINCT FROM 'firstcrack:read firstcrack:write' THEN
    RETURN jsonb_build_object('error', 'insufficient_scope');
  END IF;
  owner_id := (proof->>'firstcrack_workspace_owner_id')::uuid; actor := (proof->>'sub')::uuid;
  PERFORM set_config('request.jwt.claims', proof::text, true);
  PERFORM set_config('request.jwt.claim.sub', actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'firstcrack_mcp_writer', true);
  SELECT plan INTO current_plan FROM public.profiles WHERE id = owner_id;
  IF current_plan IS NULL OR current_plan NOT IN ('pro_plus', 'enterprise', 'team', 'tester') THEN
    RETURN jsonb_build_object('error', 'insufficient_plan');
  END IF;
  CASE tool
    WHEN 'receive_green_stock' THEN allowed := ARRAY['bean_id','quantity_g','unit_cost_per_kg']; field := 'quantity_g';
    WHEN 'adjust_green_stock', 'adjust_roasted_stock' THEN allowed := ARRAY['bean_id','delta_g']; field := 'delta_g';
    WHEN 'adjust_product_stock' THEN allowed := ARRAY['product_id','delta']; field := 'delta';
    WHEN 'record_roast_production' THEN
      allowed := ARRAY['production_id','bean_id','input_weight_g','output_weight_g','roasted_at']; field := 'input_weight_g';
    WHEN 'record_packaging_production' THEN
      allowed := ARRAY['production_id','product_id','quantity','packaged_at']; field := 'quantity';
    ELSE RETURN jsonb_build_object('error', 'invalid_arguments');
  END CASE;
  IF jsonb_typeof(args) IS DISTINCT FROM 'object' OR args - (allowed || ARRAY['request_id','reason']) <> '{}'::jsonb
    OR jsonb_typeof(args->'reason') IS DISTINCT FROM 'string' OR length(btrim(args->>'reason')) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(args->'request_id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(args->field) IS DISTINCT FROM 'number' OR args->>field !~ '^-?[0-9]+$'
    OR abs((args->>field)::numeric) NOT BETWEEN 1 AND 1000000000 THEN
    RETURN jsonb_build_object('error', 'invalid_arguments');
  END IF;
  FOREACH id_field IN ARRAY ARRAY['request_id', 'production_id', 'bean_id', 'product_id'] LOOP
    IF args ? id_field AND (jsonb_typeof(args->id_field) IS DISTINCT FROM 'string'
      OR args->>id_field !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RETURN jsonb_build_object('error', 'invalid_arguments');
    END IF;
  END LOOP;
  request := (args->>'request_id')::uuid; production := (args->>'production_id')::uuid;
  source_id := coalesce(args->>'bean_id', args->>'product_id')::uuid;
  IF source_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_arguments'); END IF;
  amount := (args->>field)::integer;
  IF field IN ('quantity_g','input_weight_g','quantity') AND amount <= 0 THEN
    RETURN jsonb_build_object('error', 'invalid_arguments');
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'inventory_requires_read_committed' USING ERRCODE = '40001';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('firstcrack.inventory:' || owner_id, 0)) THEN
    RETURN jsonb_build_object('error', 'inventory_busy');
  END IF;
  SELECT * INTO receipt FROM private.mcp_write_requests WHERE workspace_owner_id = owner_id AND request_id = request;
  IF FOUND THEN
    IF receipt.tool <> tool OR receipt.arguments <> args THEN RETURN jsonb_build_object('error', 'idempotency_conflict'); END IF;
    RETURN jsonb_build_object('result', receipt.result);
  END IF;
  IF tool LIKE 'record_%' THEN
    IF production IS NULL THEN RETURN jsonb_build_object('error', 'invalid_arguments'); END IF;
    SELECT * INTO receipt FROM private.mcp_write_requests WHERE workspace_owner_id = owner_id AND production_id = production;
    IF FOUND THEN
      RETURN jsonb_build_object('error', 'production_exists');
    END IF;
    IF EXISTS (SELECT 1 FROM private.inventory_productions WHERE workspace_owner_id = owner_id AND production_id = production) THEN
      RETURN jsonb_build_object('error', 'production_exists');
    END IF;
  END IF;
  IF args ? 'bean_id' AND NOT EXISTS (SELECT 1 FROM public.beans WHERE id = source_id AND user_id = owner_id) THEN
    RETURN jsonb_build_object('error', 'access_denied');
  END IF;
  IF args ? 'product_id' THEN
    SELECT * INTO product FROM public.products WHERE id = source_id AND user_id = owner_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'access_denied'); END IF;
  END IF;
  IF tool = 'receive_green_stock' AND args ? 'unit_cost_per_kg' THEN
    IF jsonb_typeof(args->'unit_cost_per_kg') IS DISTINCT FROM 'number' THEN RETURN jsonb_build_object('error', 'invalid_arguments'); END IF;
    cost := (args->>'unit_cost_per_kg')::numeric;
    IF cost NOT BETWEEN 0 AND 1000000000 THEN RETURN jsonb_build_object('error', 'invalid_arguments'); END IF;
  END IF;
  CASE tool
    WHEN 'receive_green_stock', 'adjust_green_stock' THEN
      INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, reference_id, note, cost_per_kg, created_by)
        VALUES(owner_id, source_id, amount, CASE WHEN tool='receive_green_stock' THEN 'purchase' ELSE 'adjustment' END,
          request, args->>'reason', cost, actor);
    WHEN 'adjust_roasted_stock' THEN
      INSERT INTO public.roasted_stock_events(user_id, bean_id, delta_grams, event_type, reference_id, note, created_by)
        VALUES(owner_id, source_id, amount, 'adjustment', request, args->>'reason', actor);
    WHEN 'adjust_product_stock' THEN
      INSERT INTO public.product_stock_events(user_id, product_id, delta_units, event_type, reference_id, note, created_by)
        VALUES(owner_id, source_id, amount, 'adjustment', request, args->>'reason', actor);
    WHEN 'record_roast_production' THEN
      IF jsonb_typeof(args->'output_weight_g') IS DISTINCT FROM 'number' OR args->>'output_weight_g' !~ '^[0-9]+$'
        OR (args->>'output_weight_g')::numeric NOT BETWEEN 1 AND amount
        OR jsonb_typeof(args->'roasted_at') IS DISTINCT FROM 'string' OR args->>'roasted_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RETURN jsonb_build_object('error', 'invalid_arguments');
      END IF;
      output := (args->>'output_weight_g')::integer; operation_at := (args->>'roasted_at')::timestamptz;
      IF NOT isfinite(operation_at) THEN RETURN jsonb_build_object('error', 'invalid_arguments'); END IF;
      PERFORM public.save_roast_op(jsonb_build_object('id', production, 'user_id', owner_id, 'bean_id', source_id,
        'weight_grams', amount, 'output_weight_grams', output, 'roasted_at', operation_at, 'notes', args->>'reason',
        'batch_title_numbering', 'none', 'status', 'completed'), true, amount, output, false);
    WHEN 'record_packaging_production' THEN
      IF NOT product.is_active OR jsonb_typeof(args->'packaged_at') IS DISTINCT FROM 'string'
        OR args->>'packaged_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RETURN jsonb_build_object('error', 'invalid_arguments');
      END IF;
      operation_at := (args->>'packaged_at')::timestamptz;
      IF NOT isfinite(operation_at) THEN RETURN jsonb_build_object('error', 'invalid_arguments'); END IF;
      consumed := amount::bigint * product.net_weight_grams;
      IF consumed > 1000000000 THEN RETURN jsonb_build_object('error', 'invalid_arguments'); END IF;
      IF product.bean_id IS NOT NULL OR product.blend_id IS NOT NULL THEN
        roasted_events := jsonb_build_array(jsonb_build_object('user_id', owner_id, 'bean_id', product.bean_id,
          'blend_id', product.blend_id, 'delta_grams', -consumed, 'event_type', 'packaging', 'reference_id', production,
          'note', args->>'reason'));
      END IF;
      PERFORM public.insert_packaging_op(jsonb_build_array(jsonb_build_object('user_id', owner_id, 'product_id', source_id,
        'delta_units', amount, 'event_type', 'roast_inbound', 'reference_id', production, 'note', args->>'reason')), roasted_events);
  END CASE;
  IF production IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private.inventory_productions WHERE workspace_owner_id = owner_id AND production_id = production
      AND transaction_id = txid_current()
  ) THEN RAISE EXCEPTION 'production_exists' USING ERRCODE = '23505'; END IF;
  IF tool = 'record_packaging_production' THEN
    UPDATE public.product_stock_events SET created_at = operation_at
      WHERE user_id = owner_id AND reference_id = production AND event_type = 'roast_inbound';
    UPDATE public.roasted_stock_events SET created_at = operation_at
      WHERE user_id = owner_id AND reference_id = production AND event_type = 'packaging';
  END IF;
  result := jsonb_strip_nulls(jsonb_build_object('request_id', request, 'production_id', production, 'tool', tool,
    'applied', true, 'recorded_at', operation_at));
  INSERT INTO private.mcp_write_requests(workspace_owner_id, request_id, production_id, tool, arguments, result, actor_id, client_id)
    VALUES(owner_id, request, production, tool, args, result, actor, proof->>'client_id');
  RETURN jsonb_build_object('result', result);
EXCEPTION
  WHEN serialization_failure THEN RETURN jsonb_build_object('error', 'inventory_busy');
  WHEN unique_violation THEN RETURN jsonb_build_object('error', 'production_exists');
  WHEN check_violation THEN
    RETURN jsonb_build_object('error', CASE WHEN SQLERRM LIKE 'insufficient_%' THEN 'insufficient_stock' ELSE 'invalid_arguments' END);
  WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('error', 'invalid_arguments');
END $$;
ALTER FUNCTION private.mcp_write(text, text, text, text, jsonb) OWNER TO firstcrack_mcp_writer;
REVOKE ALL ON FUNCTION private.mcp_write(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mcp_write(text, text, text, text, jsonb) TO firstcrack_mcp_gateway;
REVOKE CREATE ON SCHEMA private FROM firstcrack_mcp_writer;
REVOKE CREATE ON SCHEMA private FROM firstcrack_mcp_store;
