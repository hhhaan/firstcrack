import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import { type BeanMeta, beanMetaFromJoin, beanMetaLine } from '../_shared/cupping-bean-meta.ts';
import { formSchemaOrSca } from '../_shared/cupping-form.ts';
import { normalizeCuppedBy } from '../_shared/cupping-publish.ts';
import { respondServerError, serveWithSentry } from '../_shared/sentry.ts';

type SampleRow = {
    id: string;
    label: string;
    sort_order: number;
    roast_session_id: string | null;
};

type SampleOut = {
    id: string;
    label: string;
    beanName: string | null;
    beanOrigin: string | null;
    beanRegion: string | null;
    beanVariety: string | null;
    beanProcess: string | null;
    beanFarm: string | null;
    /** origin · region · variety · process · farm */
    beanMeta: string | null;
};

function toSampleOut(id: string, label: string, bean: BeanMeta | null): SampleOut {
    return {
        id,
        label,
        beanName: bean?.name ?? null,
        beanOrigin: bean?.origin ?? null,
        beanRegion: bean?.region ?? null,
        beanVariety: bean?.variety ?? null,
        beanProcess: bean?.process ?? null,
        beanFarm: bean?.farm ?? null,
        beanMeta: beanMetaLine(bean),
    };
}

serveWithSentry('get-cupping-session', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    let token: string | undefined;
    let cuppedByRaw: string | undefined;
    if (req.method === 'GET') {
        const url = new URL(req.url);
        token = url.searchParams.get('token') ?? undefined;
        cuppedByRaw = url.searchParams.get('cuppedBy') ?? undefined;
    } else if (req.method === 'POST') {
        try {
            const body = await req.json();
            token = typeof body?.token === 'string' ? body.token : undefined;
            cuppedByRaw = typeof body?.cuppedBy === 'string' ? body.cuppedBy : undefined;
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
        return respondServerError('get-cupping-session', 'lookup failed', error);
    }
    if (!invite) return jsonResponse({ error: 'not_found' }, 404);
    if (invite.revoked_at) return jsonResponse({ error: 'revoked' }, 410);
    if (new Date(invite.expires_at) <= new Date()) return jsonResponse({ error: 'expired' }, 410);
    const remainingUses = Math.max(0, invite.max_uses - invite.used_count);
    const sessionFull = invite.used_count >= invite.max_uses;

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
    let samples: SampleOut[] = [];
    let form = formSchemaOrSca(null);

    if (eventId) {
        const { data: event } = await supabase
            .from('cupping_events')
            .select('id, title, ended_at, results_token, form_snapshot')
            .eq('id', eventId)
            .maybeSingle();
        // Session closed: clients should open results (same invite token works via get-cupping-results)
        if (event?.ended_at) {
            return jsonResponse(
                {
                    error: 'ended',
                    ended: true,
                    eventId: event.id,
                    eventTitle: event.title ?? null,
                    resultsToken: event.results_token ?? null,
                },
                410,
            );
        }
        eventTitle = event?.title ?? null;
        form = formSchemaOrSca(event?.form_snapshot);

        const { data: sampleRows } = await supabase
            .from('cupping_samples')
            .select('id, label, sort_order, roast_session_id')
            .eq('event_id', eventId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        const rows = (sampleRows ?? []) as SampleRow[];
        const roastIds = [...new Set(rows.map((r) => r.roast_session_id).filter(Boolean))] as string[];
        const beanByRoast = new Map<string, BeanMeta>();
        if (roastIds.length) {
            const { data: sessions } = await supabase
                .from('roast_sessions')
                .select('id, beans(name, origin, region, variety, process, farm)')
                .in('id', roastIds);
            for (const s of sessions ?? []) {
                const beans = beanMetaFromJoin(s.beans);
                if (beans) beanByRoast.set(s.id, beans);
            }
        }

        // Legacy single-sample invite: only expose that sample
        const filtered =
            invite.sample_id && !invite.event_id
                ? rows.filter((r) => r.id === invite.sample_id)
                : rows;

        samples = filtered.map((r) =>
            toSampleOut(
                r.id,
                r.label,
                r.roast_session_id ? (beanByRoast.get(r.roast_session_id) ?? null) : null,
            ),
        );
    } else if (invite.sample_id) {
        // Orphan sample invite without event
        const { data: sample } = await supabase
            .from('cupping_samples')
            .select('id, label, roast_session_id')
            .eq('id', invite.sample_id)
            .maybeSingle();
        if (sample) {
            let bean: BeanMeta | null = null;
            if (sample.roast_session_id) {
                const { data: session } = await supabase
                    .from('roast_sessions')
                    .select('beans(name, origin, region, variety, process, farm)')
                    .eq('id', sample.roast_session_id)
                    .maybeSingle();
                bean = beanMetaFromJoin(session?.beans);
            }
            samples = [toSampleOut(sample.id, sample.label, bean)];
        }
    }

    let participant: { id: string; publishedAt: string | null } | null = null;
    let submissions: Array<{
        id: string;
        sampleId: string;
        scores: unknown;
        defects: number;
        notes: string | null;
        descriptors: string[];
        totalScore: number;
        cuppedAt: string;
    }> = [];

    if (cuppedByRaw != null && String(cuppedByRaw).trim()) {
        const cuppedBy = normalizeCuppedBy(cuppedByRaw);
        const { data: seat } = await supabase
            .from('cupping_participants')
            .select('id, published_at')
            .eq('invite_id', invite.id)
            .eq('cupped_by', cuppedBy)
            .maybeSingle();
        if (seat) {
            participant = { id: seat.id, publishedAt: seat.published_at ?? null };
        }
        const { data: rows } = await supabase
            .from('cuppings')
            .select('id, sample_id, scores, defects, notes, descriptors, total_score, cupped_at')
            .eq('invite_id', invite.id)
            .eq('cupped_by', cuppedBy);
        submissions = (rows ?? []).map((row) => ({
            id: row.id,
            sampleId: row.sample_id,
            scores: row.scores,
            defects: row.defects,
            notes: row.notes,
            descriptors: row.descriptors ?? [],
            totalScore: Number(row.total_score),
            cuppedAt: row.cupped_at,
        }));
    }

    return jsonResponse({
        inviteId: invite.id,
        eventId,
        eventTitle,
        samples,
        expiresAt: invite.expires_at,
        remainingUses,
        sessionFull,
        participant,
        submissions,
        // legacy fields for older clients
        sampleId: invite.sample_id,
        sampleLabel: samples.length === 1 ? samples[0].label : null,
        roastSessionId: invite.roast_session_id,
        beanName: samples.length === 1 ? samples[0].beanName : null,
        profileName: null,
        roastLevel: null,
        roastedAt: null,
        form,
    });
});
