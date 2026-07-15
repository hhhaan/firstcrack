import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/auth.ts';

const serviceClient = () =>
    createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    let token: string | undefined;
    if (req.method === 'GET') {
        token = new URL(req.url).searchParams.get('token') ?? undefined;
    } else if (req.method === 'POST') {
        try {
            const body = await req.json();
            token = typeof body?.token === 'string' ? body.token : undefined;
        } catch {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
    } else {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    token = token?.trim();
    if (!token) return jsonResponse({ error: 'token required' }, 400);

    const supabase = serviceClient();
    const { data: invite, error } = await supabase
        .from('cupping_invites')
        .select('id, expires_at, max_uses, used_count, revoked_at, roast_session_id, sample_id, user_id')
        .eq('token', token)
        .maybeSingle();

    if (error) {
        console.error('[get-cupping-session]', error);
        return jsonResponse({ error: 'lookup failed' }, 500);
    }
    if (!invite) return jsonResponse({ error: 'not_found' }, 404);
    if (invite.revoked_at) return jsonResponse({ error: 'revoked' }, 410);
    if (new Date(invite.expires_at) <= new Date()) return jsonResponse({ error: 'expired' }, 410);
    if (invite.used_count >= invite.max_uses) return jsonResponse({ error: 'full' }, 410);

    let sampleLabel: string | null = null;
    let roastSessionId: string | null = invite.roast_session_id;
    let beanName: string | null = null;
    let profileName: string | null = null;
    let roastLevel: string | null = null;
    let roastedAt: string | null = null;

    if (invite.sample_id) {
        const { data: sample } = await supabase
            .from('cupping_samples')
            .select('id, label, roast_session_id')
            .eq('id', invite.sample_id)
            .maybeSingle();
        if (sample) {
            sampleLabel = sample.label;
            roastSessionId = sample.roast_session_id ?? roastSessionId;
        }
    }

    if (roastSessionId) {
        const { data: session } = await supabase
            .from('roast_sessions')
            .select('id, roasted_at, roast_level, profile_id, bean_id, beans(name), roast_profiles!profile_id(name)')
            .eq('id', roastSessionId)
            .maybeSingle();
        if (session) {
            const beans = session.beans as { name: string } | null;
            const profile = session.roast_profiles as { name: string } | null;
            beanName = beans?.name ?? null;
            profileName = profile?.name ?? null;
            roastLevel = session.roast_level;
            roastedAt = session.roasted_at;
        }
    }

    return jsonResponse({
        inviteId: invite.id,
        sampleId: invite.sample_id,
        sampleLabel,
        roastSessionId,
        beanName,
        profileName,
        roastLevel,
        roastedAt,
        expiresAt: invite.expires_at,
        remainingUses: invite.max_uses - invite.used_count,
    });
});
