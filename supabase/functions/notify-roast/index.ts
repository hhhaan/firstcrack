import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import { respondServerError, serveWithSentry } from '../_shared/sentry.ts';
import { postSlack } from '../_shared/slack.ts';
import { verifySharedSecret } from '../_shared/webhook-auth.ts';

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
    const { data: roast, error } = await db
        .from('roast_sessions')
        .select('id, user_id, created_by, status, batch_name, bean_label, weight_grams, roasted_at')
        .eq('id', payload.session_id)
        .maybeSingle();
    if (error) return respondServerError('notify-roast', 'Roast lookup failed', error);
    if (roast?.status !== 'completed') return jsonResponse({ ok: true, skipped: true });

    const { data: profiles, error: profileError } = await db
        .from('profiles')
        .select('id, display_name, business_name')
        .in('id', [...new Set([roast.user_id, roast.created_by].filter(Boolean))]);
    if (profileError) return respondServerError('notify-roast', 'Profile lookup failed', profileError);
    const owner = profiles?.find((profile) => profile.id === roast.user_id);
    const actor = profiles?.find((profile) => profile.id === roast.created_by);
    const text = [
        '로스팅 저장',
        `로스터리: ${owner?.business_name || owner?.display_name || roast.user_id}`,
        `작업자: ${actor?.display_name || roast.created_by || '알 수 없음'}`,
        `배치: ${roast.batch_name || '이름 없음'}`,
        ...(roast.bean_label ? [`생두: ${roast.bean_label}`] : []),
        `투입량: ${(roast.weight_grams / 1000).toLocaleString('ko-KR')} kg`,
        ...(roast.roasted_at
            ? [
                  `로스팅 시각: ${new Date(roast.roasted_at).toLocaleString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                  })} KST`,
              ]
            : []),
        `기록: ${roast.id}`,
    ].join('\n');

    const ok = await postSlack({
        text: '로스팅이 저장되었습니다.',
        blocks: [{ type: 'section', text: { type: 'plain_text', text: text.slice(0, 3000), emoji: false } }],
    });
    if (!ok) return respondServerError('notify-roast', 'Slack notify failed');
    return jsonResponse({ ok: true });
});
