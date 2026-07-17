import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/auth.ts';

const serviceClient = () =>
    createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

type SampleRow = {
    id: string;
    label: string;
    sort_order: number;
    roast_session_id: string | null;
};

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
        .select(
            'id, expires_at, max_uses, used_count, revoked_at, roast_session_id, sample_id, event_id, user_id',
        )
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

    // Resolve event_id: direct column, or via sample (legacy per-sample invites)
    let eventId = invite.event_id as string | null;
    if (!eventId && invite.sample_id) {
        const { data: sample } = await supabase
            .from('cupping_samples')
            .select('event_id')
            .eq('id', invite.sample_id)
            .maybeSingle();
        eventId = sample?.event_id ?? null;
    }

    let eventTitle: string | null = null;
    let samples: { id: string; label: string; beanName: string | null }[] = [];

    if (eventId) {
        const { data: event } = await supabase
            .from('cupping_events')
            .select('id, title')
            .eq('id', eventId)
            .maybeSingle();
        eventTitle = event?.title ?? null;

        const { data: sampleRows } = await supabase
            .from('cupping_samples')
            .select('id, label, sort_order, roast_session_id')
            .eq('event_id', eventId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        const rows = (sampleRows ?? []) as SampleRow[];
        const roastIds = [...new Set(rows.map((r) => r.roast_session_id).filter(Boolean))] as string[];
        const beanByRoast = new Map<string, string>();
        if (roastIds.length) {
            const { data: sessions } = await supabase
                .from('roast_sessions')
                .select('id, beans(name)')
                .in('id', roastIds);
            for (const s of sessions ?? []) {
                const beans = s.beans as { name: string } | null;
                if (beans?.name) beanByRoast.set(s.id, beans.name);
            }
        }

        // Legacy single-sample invite: only expose that sample
        const filtered =
            invite.sample_id && !invite.event_id
                ? rows.filter((r) => r.id === invite.sample_id)
                : rows;

        samples = filtered.map((r) => ({
            id: r.id,
            label: r.label,
            beanName: r.roast_session_id ? (beanByRoast.get(r.roast_session_id) ?? null) : null,
        }));
    } else if (invite.sample_id) {
        // Orphan sample invite without event
        const { data: sample } = await supabase
            .from('cupping_samples')
            .select('id, label, roast_session_id')
            .eq('id', invite.sample_id)
            .maybeSingle();
        if (sample) {
            let beanName: string | null = null;
            if (sample.roast_session_id) {
                const { data: session } = await supabase
                    .from('roast_sessions')
                    .select('beans(name)')
                    .eq('id', sample.roast_session_id)
                    .maybeSingle();
                beanName = (session?.beans as { name: string } | null)?.name ?? null;
            }
            samples = [{ id: sample.id, label: sample.label, beanName }];
        }
    }

    return jsonResponse({
        inviteId: invite.id,
        eventId,
        eventTitle,
        samples,
        expiresAt: invite.expires_at,
        remainingUses: invite.max_uses - invite.used_count,
        // legacy fields for older clients
        sampleId: invite.sample_id,
        sampleLabel: samples.length === 1 ? samples[0].label : null,
        roastSessionId: invite.roast_session_id,
        beanName: samples.length === 1 ? samples[0].beanName : null,
        profileName: null,
        roastLevel: null,
        roastedAt: null,
    });
});
