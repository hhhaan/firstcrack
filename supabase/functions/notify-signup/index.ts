import { corsHeaders, jsonResponse } from '../_shared/auth.ts';
import { verifySharedSecret } from '../_shared/webhook-auth.ts';
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
                ...corsHeaders,
            },
        });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (!verifySharedSecret(Deno.env.get('NOTIFY_SIGNUP_SECRET'), req.headers.get('x-webhook-secret'))) {
        console.error('[notify-signup] unauthorized');
        return jsonResponse({ error: 'Unauthorized' }, 401);
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

    // Strip CR/LF/backticks so user-controlled fields can't inject Slack markdown lines.
    const sanitize = (s: string) => s.replace(/[\r\n`]/g, ' ').trim();

    const record = payload.record ?? {};
    const email = sanitize(record.email ?? '(no email)');
    const userId = sanitize(record.id ?? 'unknown');
    const createdAt = sanitize(record.created_at ?? new Date().toISOString());
    const meta = record.raw_user_meta_data;
    const nameRaw =
        (typeof meta?.full_name === 'string' && meta.full_name) ||
        (typeof meta?.name === 'string' && meta.name) ||
        null;
    const name = nameRaw ? sanitize(nameRaw) : null;

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
