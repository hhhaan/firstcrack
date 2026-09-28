import type { Page, Route } from '@playwright/test';
import { E2E_USER } from './constants';
import type { MockDb } from './mock-db';

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': '*',
            'Content-Range': Array.isArray(body) ? `0-${Math.max(0, body.length - 1)}/${body.length}` : '*/0',
            Prefer: '',
        },
        body: JSON.stringify(body),
    });
}

function parsePrefer(route: Route): { returnRep: boolean; count: boolean } {
    const prefer = route.request().headers().prefer ?? '';
    return {
        returnRep: prefer.includes('return=representation'),
        count: prefer.includes('count=exact'),
    };
}

function qs(url: URL) {
    return Object.fromEntries(url.searchParams.entries());
}

/**
 * Intercept Supabase Auth + PostgREST for the real Vite app.
 * Returns the shared MockDb so tests can seed and assert backend state.
 */
export async function installMockSupabase(page: Page, db: MockDb) {
    await page.route('**/auth/v1/**', async (route) => {
        if (route.request().method() === 'OPTIONS') {
            return route.fulfill({
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': '*',
                },
            });
        }
        const url = new URL(route.request().url());
        const path = url.pathname;

        if (path.endsWith('/user') || path.includes('/user')) {
            return json(route, {
                id: E2E_USER.id,
                email: E2E_USER.email,
                aud: 'authenticated',
                role: 'authenticated',
                app_metadata: {},
                user_metadata: {},
                created_at: new Date().toISOString(),
            });
        }

        if (path.includes('/token') || path.includes('/session')) {
            return json(route, {
                access_token: 'e2e-access',
                refresh_token: 'e2e-refresh',
                expires_in: 3600,
                token_type: 'bearer',
                user: {
                    id: E2E_USER.id,
                    email: E2E_USER.email,
                    aud: 'authenticated',
                    role: 'authenticated',
                },
            });
        }

        return json(route, {});
    });

    await page.route('**/rest/v1/**', async (route) => {
        if (route.request().method() === 'OPTIONS') {
            return route.fulfill({
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': '*',
                },
            });
        }

        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/rest\/v1\//, '');
        const method = route.request().method();
        const prefer = parsePrefer(route);

        // RPCs
        if (path.startsWith('rpc/')) {
            const fn = path.slice(4);
            let body: Record<string, unknown> = {};
            try {
                body = route.request().postDataJSON() as Record<string, unknown>;
            } catch {
                body = {};
            }

            if (fn === 'get_bean_stock_summary') {
                return json(route, db.stockSummary(String(body.p_bean_id)));
            }
            if (fn === 'get_user_stock_summaries') {
                return json(route, db.userStockSummaries(String(body.p_user_id ?? E2E_USER.id)));
            }
            if (fn === 'get_bean_current_stock' || fn === 'get_bean_available_stock') {
                return json(route, db.beanStockGrams(String(body.p_bean_id)));
            }
            if (fn === 'get_bean_reserved_stock') {
                return json(route, 0);
            }
            if (fn === 'save_roast_op') {
                const session = db.saveRoastOp({
                    session: (body.p_session as Record<string, unknown>) ?? {},
                    deduct: Boolean(body.p_deduct),
                    deductionGrams: Number(body.p_deduction_grams) || 0,
                    inboundGrams: Number(body.p_inbound_grams) || 0,
                    inboundIsEstimate: Boolean(body.p_inbound_is_estimate),
                });
                return json(route, session);
            }
            if (fn === 'update_roast_session_record') {
                const res = db.updateRoastRecord(body);
                return json(route, res.body, res.status);
            }
            if (fn === 'insert_stock_events_batch') {
                const events = (body.p_events as Record<string, unknown>[]) ?? [];
                for (const e of events) {
                    db.insertStockEvent({
                        user_id: String(e.user_id ?? E2E_USER.id),
                        bean_id: String(e.bean_id),
                        delta_grams: Number(e.delta_grams) || 0,
                        event_type: String(e.event_type ?? 'roast'),
                        reference_id: (e.reference_id as string | null) ?? null,
                        cost_per_kg: (e.cost_per_kg as number | null) ?? null,
                    });
                }
                return json(route, null);
            }
            if (fn === 'compute_inventory_alerts') {
                return json(route, null);
            }
            if (fn === 'get_user_roasted_stock' || fn === 'get_user_product_stock') {
                return json(route, {});
            }
            if (fn === 'list_org_members') {
                return json(route, []);
            }
            if (fn === 'get_roasting_requirements') {
                return json(route, []);
            }
            // Default RPC ok
            return json(route, null);
        }

        // Tables
        const table = path.split('?')[0].split('/')[0];
        let body: unknown = null;
        if (method === 'POST' || method === 'PATCH') {
            try {
                body = route.request().postDataJSON();
            } catch {
                body = null;
            }
        }
        const params = qs(url);

        if (table === 'profiles') {
            if (method === 'GET') {
                return json(route, {
                    id: E2E_USER.id,
                    plan: 'pro',
                    business_name: 'E2E Roastery',
                    email: E2E_USER.email,
                });
            }
            if (method === 'PATCH') {
                return json(route, { id: E2E_USER.id, plan: 'pro' });
            }
        }

        if (table === 'organization_members' || table === 'organizations') {
            return json(route, []);
        }

        if (table === 'beans') {
            if (method === 'GET') {
                const userId = params['user_id']?.replace('eq.', '') ?? E2E_USER.id;
                const id = params['id']?.replace('eq.', '');
                if (id) {
                    const bean = db.beans.find((b) => b.id === id);
                    return json(route, bean ?? null, bean ? 200 : 406);
                }
                return json(
                    route,
                    db.beans.filter((b) => b.user_id === userId),
                );
            }
            if (method === 'POST') {
                const rows = Array.isArray(body) ? body : [body];
                const created = rows.map((r) => db.createBean((r as Record<string, unknown>) ?? {}));
                return json(route, prefer.returnRep ? (created.length === 1 ? created[0] : created) : null, 201);
            }
            if (method === 'PATCH') {
                const id = params['id']?.replace('eq.', '');
                const bean = db.beans.find((b) => b.id === id);
                if (bean && body && typeof body === 'object') {
                    Object.assign(bean, body);
                }
                return json(route, bean ?? null);
            }
            if (method === 'DELETE') {
                const id = params['id']?.replace('eq.', '');
                db.beans = db.beans.filter((b) => b.id !== id);
                return json(route, null, 204);
            }
        }

        if (table === 'bean_stock_events') {
            if (method === 'GET') {
                let rows = [...db.stockEvents];
                if (params['bean_id']?.startsWith('eq.')) {
                    const beanId = params['bean_id'].slice(3);
                    rows = rows.filter((e) => e.bean_id === beanId);
                }
                if (params['user_id']?.startsWith('eq.')) {
                    const userId = params['user_id'].slice(3);
                    rows = rows.filter((e) => e.user_id === userId);
                }
                if (params['reference_id']?.startsWith('eq.')) {
                    const ref = params['reference_id'].slice(3);
                    rows = rows.filter((e) => e.reference_id === ref);
                }
                if (params['event_type']?.startsWith('eq.')) {
                    const et = params['event_type'].slice(3);
                    rows = rows.filter((e) => e.event_type === et);
                }
                if (params['select'] === 'id' || params.select?.includes('id')) {
                    // hasRoastDeductionForReference uses select id limit 1
                    return json(
                        route,
                        rows.slice(0, 1).map((e) => ({ id: e.id })),
                    );
                }
                return json(route, rows);
            }
            if (method === 'POST') {
                const rows = Array.isArray(body) ? body : [body];
                const created = rows.map((r) => {
                    const row = r as Record<string, unknown>;
                    return db.insertStockEvent({
                        user_id: String(row.user_id ?? E2E_USER.id),
                        bean_id: String(row.bean_id),
                        delta_grams: Number(row.delta_grams) || 0,
                        event_type: String(row.event_type ?? 'purchase'),
                        reference_id: (row.reference_id as string | null) ?? null,
                        cost_per_kg: (row.cost_per_kg as number | null) ?? null,
                        note: (row.note as string | null) ?? null,
                    });
                });
                return json(route, created.length === 1 ? created[0] : created, 201);
            }
        }

        if (table === 'roast_sessions') {
            if (method === 'GET') {
                const userId = params['user_id']?.replace('eq.', '') ?? E2E_USER.id;
                let rows = db.sessions.filter((s) => s.user_id === userId);
                if (params['status']?.startsWith('eq.')) {
                    rows = rows.filter((s) => s.status === params['status']!.slice(3));
                }
                // head count
                if (
                    method === 'GET' &&
                    route.request().headers().prefer?.includes('count=exact') &&
                    params.select?.includes('id')
                ) {
                    // Prefer: count=exact, head: true — supabase count queries
                }
                if (prefer.count && route.request().headers().accept?.includes('application/json')) {
                    // return data + range
                }
                // For count-only (head)
                if (
                    route.request().method() === 'HEAD' ||
                    route.request().headers()['prefer']?.includes('count=exact')
                ) {
                    // still return body for simplicity
                }
                return json(route, rows);
            }
            if (method === 'POST') {
                // rare direct insert
                return json(route, { id: crypto.randomUUID() }, 201);
            }
        }

        if (table === 'day_plans') {
            if (method === 'GET') {
                return json(route, db.dayPlans);
            }
            if (method === 'POST') {
                const row = {
                    id: crypto.randomUUID(),
                    user_id: E2E_USER.id,
                    plan_date: (body as { plan_date?: string })?.plan_date ?? new Date().toISOString().slice(0, 10),
                };
                db.dayPlans.push(row);
                return json(route, row, 201);
            }
        }

        if (table === 'roast_plan_batches') {
            if (method === 'GET') {
                return json(route, db.planBatches);
            }
            if (method === 'PATCH') {
                const id = params['id']?.replace('eq.', '');
                const batch = db.planBatches.find((b) => b.id === id);
                if (batch && body && typeof body === 'object') Object.assign(batch, body);
                return json(route, batch ?? null);
            }
        }

        if (table === 'roast_profiles' || table === 'blends' || table === 'blend_components') {
            return json(route, []);
        }

        if (table === 'machines' || table === 'products' || table === 'orders' || table === 'order_lines') {
            return json(route, []);
        }

        if (table === 'inventory_alerts') {
            return json(route, []);
        }

        if (table === 'sales_channel_connections') {
            return json(route, []);
        }

        // Fallback empty
        if (method === 'GET') return json(route, []);
        return json(route, null);
    });

    // External / optional APIs — do not fail the shell
    await page.route('**/functions/v1/**', async (route) => {
        if (route.request().method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
        }
        if (route.request().url().includes('/get-download-url')) {
            const key = String((route.request().postDataJSON() as { key?: unknown } | null)?.key ?? '');
            return json(route, { url: `https://e2e.r2.local/${encodeURIComponent(key)}` });
        }
        return json(route, {});
    });

    await page.route('**/e2e.r2.local/**', async (route) => {
        const key = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
        const tsv = db.tsvFiles.get(key);
        return route.fulfill({
            status: tsv == null ? 404 : 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'text/tab-separated-values',
            body: tsv ?? '',
        });
    });

    await page.route('**/api.open-meteo.com/**', async (route) => {
        return json(route, { current: { temperature_2m: 20, relative_humidity_2m: 50 } });
    });
}
