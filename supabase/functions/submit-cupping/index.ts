import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import {
    formSchemaOrSca,
    parseScoresForForm,
    totalScoreForForm,
    type CuppingFormSchema,
} from '../_shared/cupping-form.ts';
import { normalizeCuppedBy, parseInviteAction, parsePublishSamples } from '../_shared/cupping-publish.ts';
import { normalizeDescriptors } from '../_shared/cupping-score.ts';
import { respondServerError, serveWithSentry } from '../_shared/sentry.ts';

const serviceClient = () =>
    createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

type Sb = ReturnType<typeof serviceClient>;

type Body = {
    token?: string;
    action?: string;
    participantId?: string;
    sampleId?: string;
    samples?: unknown;
    roastSessionId?: string;
    cuppedBy?: string;
    scores?: unknown;
    defects?: number;
    notes?: string | null;
    descriptors?: string[];
    source?: 'desktop' | 'web' | 'invite';
};

type InviteRow = {
    id: string;
    user_id: string;
    roast_session_id: string | null;
    sample_id: string | null;
    event_id: string | null;
    expires_at: string;
    max_uses: number;
    used_count: number;
    revoked_at: string | null;
};

type Participant = {
    id: string;
    cupped_by: string;
    published_at: string | null;
};

type SampleRef = { id: string; roast_session_id: string | null; event_id: string | null };

type Scorecard = {
    scores: Record<string, unknown>;
    defects: number;
    totalScore: number;
    formVersion: string;
    notes: string | null;
    descriptors: string[];
};

/**
 * Invite path:
 * - claim: reserve a seat (used_count / cupping_participants), no scores
 * - publish: write all scorecards then lock the participant (once)
 * - legacy: per-sample upsert, no lock (old clients)
 */
serveWithSentry('submit-cupping', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    let body: Body;
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const supabase = serviceClient();

    if (body.token?.trim()) {
        return handleInvite(supabase, body);
    }

    return handleOwner(supabase, req, body);
});

async function handleInvite(supabase: Sb, body: Body): Promise<Response> {
    let action: 'claim' | 'publish' | 'legacy';
    try {
        action = parseInviteAction(body.action);
        if (action === 'legacy' && Array.isArray(body.samples)) action = 'publish';
    } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'invalid action' }, 400);
    }

    const cuppedBy = normalizeCuppedBy(body.cuppedBy);
    const token = body.token!.trim();
    const participantId = typeof body.participantId === 'string' ? body.participantId.trim() : '';

    const { data: invite, error } = await supabase
        .from('cupping_invites')
        .select(
            'id, user_id, roast_session_id, sample_id, event_id, expires_at, max_uses, used_count, revoked_at',
        )
        .eq('token', token)
        .maybeSingle();

    if (error) {
        console.error('[submit-cupping] invite', error);
        return respondServerError('submit-cupping', 'lookup failed', error);
    }
    if (!invite) return jsonResponse({ error: 'not_found' }, 404);
    const closed = inviteClosed(invite);
    if (closed) return closed;

    const ctx = await resolveInviteContext(supabase, invite, body.sampleId);
    if (ctx instanceof Response) return ctx;

    const seat = await ensureSeat(supabase, invite, cuppedBy, participantId);
    if (seat instanceof Response) return seat;

    if (action === 'claim') {
        if (seat.participant.published_at) {
            const submissions = await loadSubmissions(supabase, invite.id, seat.participant.cupped_by);
            if (submissions instanceof Response) return submissions;
            return jsonResponse({
                participantId: seat.participant.id,
                publishedAt: seat.participant.published_at,
                remainingUses: Math.max(0, invite.max_uses - invite.used_count),
                submissions,
            });
        }
        return jsonResponse({
            participantId: seat.participant.id,
            publishedAt: null,
            remainingUses: Math.max(0, invite.max_uses - invite.used_count),
        });
    }

    if (seat.participant.published_at) {
        const submissions = await loadSubmissions(supabase, invite.id, seat.participant.cupped_by);
        if (submissions instanceof Response) return submissions;
        return jsonResponse(
            {
                error: 'already_published',
                participantId: seat.participant.id,
                publishedAt: seat.participant.published_at,
                submissions,
            },
            409,
        );
    }

    if (action === 'publish') {
        let rawSamples;
        try {
            rawSamples = parsePublishSamples(body.samples);
        } catch (e) {
            return jsonResponse({ error: e instanceof Error ? e.message : 'invalid samples' }, 400);
        }

        const cards: Array<Scorecard & { sample: SampleRef }> = [];
        for (const raw of rawSamples) {
            const sample = ctx.sampleById.get(raw.sampleId);
            if (!sample) return jsonResponse({ error: 'sample_not_found' }, 404);
            try {
                cards.push({
                    ...scoreFromForm(ctx.schema, {
                        scores: raw.scores,
                        defects: raw.defects,
                        notes: raw.notes,
                        descriptors: raw.descriptors,
                    }),
                    sample,
                });
            } catch (e) {
                return jsonResponse({ error: e instanceof Error ? e.message : 'invalid scores' }, 400);
            }
        }

        const written = await writeScorecards(supabase, invite, ctx, cuppedBy, cards);
        if (written instanceof Response) return written;

        const locked = await lockParticipant(supabase, seat.participant.id);
        if (locked instanceof Response) return locked;

        return jsonResponse(
            {
                participantId: seat.participant.id,
                publishedAt: locked,
                remainingUses: Math.max(0, invite.max_uses - invite.used_count),
                results: written,
            },
            201,
        );
    }

    let card: Scorecard;
    try {
        card = scoreFromForm(ctx.schema, {
            scores: body.scores,
            defects: body.defects,
            notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null,
            descriptors: normalizeDescriptors(body.descriptors),
        });
    } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'invalid scores' }, 400);
    }

    const sampleId = (body.sampleId?.trim() || invite.sample_id) as string | null;
    if (!sampleId) return jsonResponse({ error: 'sampleId required' }, 400);
    const sample = ctx.sampleById.get(sampleId);
    if (!sample) return jsonResponse({ error: 'sample_not_found' }, 404);

    const written = await writeScorecards(supabase, invite, ctx, cuppedBy, [{ ...card, sample }]);
    if (written instanceof Response) return written;
    const row = written[0];
    return jsonResponse({ id: row.id, totalScore: row.totalScore, cuppedAt: row.cuppedAt }, row.created ? 201 : 200);
}

function inviteClosed(invite: Pick<InviteRow, 'revoked_at' | 'expires_at'>): Response | null {
    if (invite.revoked_at) return jsonResponse({ error: 'revoked' }, 410);
    if (new Date(invite.expires_at) <= new Date()) return jsonResponse({ error: 'expired' }, 410);
    return null;
}

function scoreFromForm(
    schema: CuppingFormSchema,
    body: { scores: unknown; defects?: number; notes: string | null; descriptors: string[] },
): Scorecard {
    const scores = parseScoresForForm(schema, body.scores);
    const defects =
        typeof body.defects === 'number' && Number.isInteger(body.defects) && body.defects >= 0
            ? body.defects
            : 0;
    return {
        scores,
        defects,
        totalScore: totalScoreForForm(schema, scores, defects),
        formVersion: schema.key,
        notes: body.notes,
        descriptors: body.descriptors,
    };
}

type InviteCtx = {
    schema: CuppingFormSchema;
    sampleById: Map<string, SampleRef>;
    allowedIds: Set<string>;
    profileByRoast: Map<string, string | null>;
};

async function resolveInviteContext(
    supabase: Sb,
    invite: InviteRow,
    bodySampleId: string | undefined,
): Promise<InviteCtx | Response> {
    const sampleById = new Map<string, SampleRef>();

    if (invite.event_id) {
        const { data: event } = await supabase
            .from('cupping_events')
            .select('ended_at, form_snapshot')
            .eq('id', invite.event_id)
            .maybeSingle();
        if (event?.ended_at) return jsonResponse({ error: 'ended' }, 410);
        const schema = formSchemaOrSca(event?.form_snapshot);
        const { data: rows } = await supabase
            .from('cupping_samples')
            .select('id, roast_session_id, event_id')
            .eq('event_id', invite.event_id);
        for (const row of rows ?? []) sampleById.set(row.id, row);
        const profileByRoast = await loadProfiles(supabase, sampleById);
        return { schema, sampleById, allowedIds: new Set(sampleById.keys()), profileByRoast };
    }

    const sampleId = (bodySampleId?.trim() || invite.sample_id) as string | null;
    let eventId: string | null = null;
    if (invite.sample_id) {
        const { data: sample } = await supabase
            .from('cupping_samples')
            .select('id, roast_session_id, event_id')
            .eq('id', invite.sample_id)
            .maybeSingle();
        if (sample) {
            sampleById.set(sample.id, sample);
            eventId = sample.event_id;
        }
    } else if (sampleId) {
        const { data: sample } = await supabase
            .from('cupping_samples')
            .select('id, roast_session_id, event_id')
            .eq('id', sampleId)
            .maybeSingle();
        if (!sample) return jsonResponse({ error: 'sample_not_found' }, 404);
        sampleById.set(sample.id, sample);
        eventId = sample.event_id;
    }

    let schema: CuppingFormSchema = formSchemaOrSca(null);
    if (eventId) {
        const { data: event } = await supabase
            .from('cupping_events')
            .select('ended_at, form_snapshot')
            .eq('id', eventId)
            .maybeSingle();
        if (event?.ended_at) return jsonResponse({ error: 'ended' }, 410);
        schema = formSchemaOrSca(event?.form_snapshot);
    }

    const profileByRoast = await loadProfiles(supabase, sampleById);
    return { schema, sampleById, allowedIds: new Set(sampleById.keys()), profileByRoast };
}

async function loadProfiles(supabase: Sb, sampleById: Map<string, SampleRef>): Promise<Map<string, string | null>> {
    const roastIds = [
        ...new Set(
            [...sampleById.values()].map((s) => s.roast_session_id).filter((id): id is string => Boolean(id)),
        ),
    ];
    const profileByRoast = new Map<string, string | null>();
    if (!roastIds.length) return profileByRoast;
    const { data: sessions } = await supabase.from('roast_sessions').select('id, profile_id').in('id', roastIds);
    for (const s of sessions ?? []) profileByRoast.set(s.id, s.profile_id ?? null);
    return profileByRoast;
}

async function loadParticipant(
    supabase: Sb,
    inviteId: string,
    opts: { id?: string; cuppedBy: string },
): Promise<Participant | Response | null> {
    if (opts.id) {
        const { data, error } = await supabase
            .from('cupping_participants')
            .select('id, cupped_by, published_at')
            .eq('id', opts.id)
            .eq('invite_id', inviteId)
            .maybeSingle();
        if (error) {
            console.error('[submit-cupping] participant by id', error);
            return respondServerError('submit-cupping', 'lookup failed', error);
        }
        if (data) return data;
    }
    const { data, error } = await supabase
        .from('cupping_participants')
        .select('id, cupped_by, published_at')
        .eq('invite_id', inviteId)
        .eq('cupped_by', opts.cuppedBy)
        .maybeSingle();
    if (error) {
        console.error('[submit-cupping] participant by name', error);
        return respondServerError('submit-cupping', 'lookup failed', error);
    }
    return data;
}

async function ensureSeat(
    supabase: Sb,
    invite: InviteRow,
    cuppedBy: string,
    participantId: string,
): Promise<{ participant: Participant } | Response> {
    let existing = await loadParticipant(supabase, invite.id, { id: participantId || undefined, cuppedBy });
    if (existing instanceof Response) return existing;
    if (existing) {
        if (!existing.published_at && existing.cupped_by !== cuppedBy) {
            const { data: renamed, error } = await supabase
                .from('cupping_participants')
                .update({ cupped_by: cuppedBy })
                .eq('id', existing.id)
                .is('published_at', null)
                .select('id, cupped_by, published_at')
                .maybeSingle();
            if (error?.code === '23505') return jsonResponse({ error: 'name_taken' }, 409);
            if (error) {
                console.error('[submit-cupping] rename', error);
                return respondServerError('submit-cupping', 'lookup failed', error);
            }
            if (renamed) existing = renamed;
        }
        return { participant: existing };
    }

    const { data: priorScore, error: priorErr } = await supabase
        .from('cuppings')
        .select('id')
        .eq('invite_id', invite.id)
        .eq('cupped_by', cuppedBy)
        .limit(1)
        .maybeSingle();
    if (priorErr) {
        console.error('[submit-cupping] prior cupper', priorErr);
        return respondServerError('submit-cupping', 'lookup failed', priorErr);
    }

    if (!priorScore) {
        const bumped = await bumpUsedCount(supabase, invite);
        if (bumped instanceof Response) return bumped;
    }

    const { data: inserted, error: insErr } = await supabase
        .from('cupping_participants')
        .insert({
            invite_id: invite.id,
            user_id: invite.user_id,
            cupped_by: cuppedBy,
        })
        .select('id, cupped_by, published_at')
        .single();

    if (insErr?.code === '23505') {
        const raced = await loadParticipant(supabase, invite.id, { cuppedBy });
        if (raced instanceof Response) return raced;
        if (raced) return { participant: raced };
    }
    if (insErr || !inserted) {
        console.error('[submit-cupping] participant insert', insErr);
        return respondServerError('submit-cupping', 'insert failed', insErr);
    }
    return { participant: inserted };
}

async function bumpUsedCount(supabase: Sb, invite: InviteRow): Promise<true | Response> {
    for (let attempt = 0; attempt < 12; attempt++) {
        const { data: current, error: curErr } = await supabase
            .from('cupping_invites')
            .select('id, used_count, max_uses, revoked_at, expires_at')
            .eq('id', invite.id)
            .maybeSingle();
        if (curErr || !current) return respondServerError('submit-cupping', 'lookup failed', curErr);
        const closed = inviteClosed(current);
        if (closed) return closed;
        if (current.used_count >= current.max_uses) return jsonResponse({ error: 'full' }, 410);

        const { data: bumped, error: bumpErr } = await supabase
            .from('cupping_invites')
            .update({ used_count: current.used_count + 1 })
            .eq('id', invite.id)
            .eq('used_count', current.used_count)
            .lt('used_count', current.max_uses)
            .is('revoked_at', null)
            .select('id')
            .maybeSingle();

        if (bumpErr) {
            console.error('[submit-cupping] bump', bumpErr);
            return respondServerError('submit-cupping', 'lookup failed', bumpErr);
        }
        if (bumped) {
            invite.used_count = current.used_count + 1;
            return true;
        }
    }
    return jsonResponse({ error: 'full' }, 410);
}

type WrittenRow = {
    id: string;
    sampleId: string;
    totalScore: number;
    cuppedAt: string;
    created: boolean;
};

async function writeScorecards(
    supabase: Sb,
    invite: InviteRow,
    ctx: InviteCtx,
    cuppedBy: string,
    cards: Array<Scorecard & { sample: SampleRef }>,
): Promise<WrittenRow[] | Response> {
    const sampleIds = cards.map((c) => c.sample.id);
    const { data: existing, error: exErr } = await supabase
        .from('cuppings')
        .select('id, sample_id, cupped_at')
        .eq('invite_id', invite.id)
        .eq('cupped_by', cuppedBy)
        .in('sample_id', sampleIds);
    if (exErr) {
        console.error('[submit-cupping] existing lookup', exErr);
        return respondServerError('submit-cupping', 'lookup failed', exErr);
    }
    const existingBySample = new Map((existing ?? []).map((row) => [row.sample_id as string, row]));
    const out: WrittenRow[] = [];
    const inserts: Array<Record<string, unknown>> = [];

    for (const card of cards) {
        const roastSessionId = card.sample.roast_session_id ?? invite.roast_session_id;
        const profileId = roastSessionId ? (ctx.profileByRoast.get(roastSessionId) ?? null) : null;
        const payload = {
            roast_session_id: roastSessionId,
            roast_profile_id: profileId,
            scores: card.scores,
            total_score: card.totalScore,
            defects: card.defects,
            notes: card.notes,
            descriptors: card.descriptors,
            form_version: card.formVersion,
        };
        const found = existingBySample.get(card.sample.id);
        if (found) {
            const { data: row, error: updErr } = await supabase
                .from('cuppings')
                .update(payload)
                .eq('id', found.id)
                .select('id, total_score, cupped_at, sample_id')
                .single();
            if (updErr || !row) {
                console.error('[submit-cupping] update', updErr);
                return respondServerError('submit-cupping', 'update failed', updErr);
            }
            out.push({
                id: row.id,
                sampleId: row.sample_id,
                totalScore: Number(row.total_score),
                cuppedAt: row.cupped_at,
                created: false,
            });
        } else {
            inserts.push({
                ...payload,
                user_id: invite.user_id,
                sample_id: card.sample.id,
                cupped_by: cuppedBy,
                source: 'invite',
                invite_id: invite.id,
            });
        }
    }

    if (inserts.length) {
        const { data: rows, error: insertErr } = await supabase
            .from('cuppings')
            .insert(inserts)
            .select('id, total_score, cupped_at, sample_id');
        if (insertErr || !rows) {
            console.error('[submit-cupping] insert', insertErr);
            return respondServerError('submit-cupping', 'insert failed', insertErr);
        }
        for (const row of rows) {
            out.push({
                id: row.id,
                sampleId: row.sample_id,
                totalScore: Number(row.total_score),
                cuppedAt: row.cupped_at,
                created: true,
            });
        }
    }

    return out;
}

async function lockParticipant(supabase: Sb, participantId: string): Promise<string | Response> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('cupping_participants')
        .update({ published_at: now })
        .eq('id', participantId)
        .is('published_at', null)
        .select('published_at')
        .maybeSingle();
    if (error) {
        console.error('[submit-cupping] lock', error);
        return respondServerError('submit-cupping', 'update failed', error);
    }
    if (!data?.published_at) return jsonResponse({ error: 'already_published' }, 409);
    return data.published_at;
}

async function loadSubmissions(supabase: Sb, inviteId: string, cuppedBy: string) {
    const { data, error } = await supabase
        .from('cuppings')
        .select('id, sample_id, scores, defects, notes, descriptors, total_score, cupped_at')
        .eq('invite_id', inviteId)
        .eq('cupped_by', cuppedBy);
    if (error) {
        console.error('[submit-cupping] submissions', error);
        return respondServerError('submit-cupping', 'lookup failed', error);
    }
    return (data ?? []).map((row) => ({
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

async function handleOwner(supabase: Sb, req: Request, body: Body): Promise<Response> {
    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const cuppedBy = normalizeCuppedBy(body.cuppedBy);
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;
    const descriptors = normalizeDescriptors(body.descriptors);

    const sampleId = body.sampleId?.trim() || null;
    let roastSessionId = body.roastSessionId?.trim() || null;
    let profileId: string | null = null;

    let ownerEventId: string | null = null;
    if (sampleId) {
        const { data: sample, error: sampleErr } = await supabase
            .from('cupping_samples')
            .select('id, roast_session_id, user_id, event_id')
            .eq('id', sampleId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (sampleErr) return respondServerError('submit-cupping', 'lookup failed', sampleErr);
        if (!sample) return jsonResponse({ error: 'sample_not_found' }, 404);
        roastSessionId = sample.roast_session_id ?? roastSessionId;
        ownerEventId = sample.event_id ?? null;
    }

    if (roastSessionId) {
        const { data: session, error: sessionErr } = await supabase
            .from('roast_sessions')
            .select('id, profile_id, user_id')
            .eq('id', roastSessionId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (sessionErr) return respondServerError('submit-cupping', 'lookup failed', sessionErr);
        if (!session) return jsonResponse({ error: 'session_not_found' }, 404);
        profileId = session.profile_id;
    }

    if (!sampleId && !roastSessionId) {
        return jsonResponse({ error: 'sampleId or roastSessionId required' }, 400);
    }

    const source = body.source === 'web' ? 'web' : 'desktop';

    let ownerSchema = formSchemaOrSca(null);
    if (ownerEventId) {
        const { data: event } = await supabase
            .from('cupping_events')
            .select('form_snapshot')
            .eq('id', ownerEventId)
            .maybeSingle();
        ownerSchema = formSchemaOrSca(event?.form_snapshot);
    }
    let parsed: Scorecard;
    try {
        parsed = scoreFromForm(ownerSchema, { scores: body.scores, defects: body.defects, notes, descriptors });
    } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'invalid scores' }, 400);
    }

    const { data: row, error: insertErr } = await supabase
        .from('cuppings')
        .insert({
            user_id: user.id,
            roast_session_id: roastSessionId,
            sample_id: sampleId,
            roast_profile_id: profileId,
            scores: parsed.scores,
            total_score: parsed.totalScore,
            defects: parsed.defects,
            cupped_by: cuppedBy,
            notes,
            descriptors,
            source,
            form_version: parsed.formVersion,
        })
        .select('id, total_score, cupped_at')
        .single();

    if (insertErr || !row) {
        console.error('[submit-cupping] owner insert', insertErr);
        return respondServerError('submit-cupping', 'insert failed', insertErr);
    }

    return jsonResponse({ id: row.id, totalScore: row.total_score, cuppedAt: row.cupped_at }, 201);
}
