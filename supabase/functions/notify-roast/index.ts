import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import { respondServerError, serveWithSentry } from '../_shared/sentry.ts';
import { postSlack } from '../_shared/slack.ts';
import { verifySharedSecret } from '../_shared/webhook-auth.ts';
import { type NotificationRoast, roastSlackPayload } from './message.ts';

serveWithSentry('notify-roast', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    if (!verifySharedSecret(Deno.env.get('NOTIFY_ROAST_SECRET'), req.headers.get('x-webhook-secret'))) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let payload: unknown;
    try {
        payload = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }
    if (
        typeof payload !== 'object' ||
        payload === null ||
        !('session_id' in payload) ||
        typeof payload.session_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.session_id)
    ) {
        return jsonResponse({ error: 'Invalid session_id' }, 400);
    }

    const db = serviceClient();
    const { data, error } = await db
        .from('roast_sessions')
        .select(
            'id, user_id, created_by, status, batch_name, profile_batch_number, total_batch_number, bean_label, profile_id, machine_name, machine_brand, weight_grams, output_weight_grams, duration_seconds, events, charge_temp_celsius, drop_temp_celsius, roast_level, color_whole, color_ground, moisture_pct, density_g_per_l, ambient_temp_celsius, ambient_humidity_pct, notes, roasted_at, updated_at, beans(name), blends(name)',
        )
        .eq('id', payload.session_id)
        .maybeSingle()
        .returns<NotificationRoast>();
    if (error) return respondServerError('notify-roast', 'Roast lookup failed', error);
    const roast: NotificationRoast | null = data;
    if (roast?.status !== 'completed') return jsonResponse({ ok: true, skipped: true });

    const [profileResult, authResult, referenceResult] = await Promise.allSettled([
        db
            .from('profiles')
            .select('id, display_name, business_name')
            .in('id', roast.created_by ? [roast.user_id, roast.created_by] : [roast.user_id]),
        roast.created_by
            ? db.auth.admin.getUserById(roast.created_by)
            : Promise.resolve({ data: { user: null }, error: null }),
        roast.profile_id
            ? db.from('roast_profiles').select('name').eq('id', roast.profile_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);
    const profiles =
        profileResult.status === 'fulfilled' && !profileResult.value.error ? profileResult.value.data : null;
    const owner = profiles?.find((profile) => profile.id === roast.user_id);
    const actor = profiles?.find((profile) => profile.id === roast.created_by);
    const authUser = authResult.status === 'fulfilled' && !authResult.value.error ? authResult.value.data.user : null;
    const profileName =
        referenceResult.status === 'fulfilled' && !referenceResult.value.error
            ? referenceResult.value.data?.name
            : null;

    const ok = await postSlack(
        roastSlackPayload({
            roast,
            owner: owner ?? null,
            actor: actor ?? null,
            actorEmail: authUser?.id === roast.created_by ? (authUser.email ?? null) : null,
            profileName: profileName ?? null,
        }),
    );
    if (!ok) return respondServerError('notify-roast', 'Slack notify failed');
    return jsonResponse({ ok: true });
});
