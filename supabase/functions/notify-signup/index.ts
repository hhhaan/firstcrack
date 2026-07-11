import { jsonResponse } from '../_shared/auth.ts';
import { postSlack } from '../_shared/slack.ts';

/** Supabase Database Webhook payload for auth.users INSERT */
type DbWebhookPayload = {
    type?: string;
    table?: string;
    schema?: string;
    record?: {
        id?: string;
        email?: string | null;
        created_at?: string;
        raw_user_meta_data?: Record<string, unknown> | null;
    };
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'authorization, content-type',
            },
        });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let payload: DbWebhookPayload;
    try {
        payload = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (payload.type && payload.type !== 'INSERT') {
        return jsonResponse({ ok: true, skipped: true });
    }

    const record = payload.record ?? {};
    const email = record.email ?? '(no email)';
    const userId = record.id ?? 'unknown';
    const createdAt = record.created_at ?? new Date().toISOString();
    const meta = record.raw_user_meta_data;
    const name =
        (typeof meta?.full_name === 'string' && meta.full_name) ||
        (typeof meta?.name === 'string' && meta.name) ||
        null;

    const lines = [
        '*New signup*',
        `• email: \`${email}\``,
        `• id: \`${userId}\``,
        ...(name ? [`• name: ${name}`] : []),
        `• at: ${createdAt}`,
    ];

    const ok = await postSlack({ text: lines.join('\n') });
    if (!ok) {
        return jsonResponse({ error: 'Slack notify failed' }, 502);
    }

    return jsonResponse({ ok: true });
});
