import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { normalizeDescriptors, parseScaV1Scores, totalScoreScaV1 } from '../_shared/cupping-score.ts';

const serviceClient = () =>
    createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

type Body = {
    token?: string;
    sampleId?: string;
    roastSessionId?: string;
    cuppedBy?: string;
    scores?: unknown;
    defects?: number;
    notes?: string | null;
    descriptors?: string[];
    source?: 'desktop' | 'web' | 'invite';
};

/**
 * Invite path domain rules (table session):
 * - Unit of work = cupper × sample scorecard (upsert by invite + sample + cupped_by)
 * - used_count seats = unique cuppers on this invite, not rows per sample
 * - Re-sync / edit same sample does not burn another seat
 */
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    let body: Body;
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    let scores;
    try {
        scores = parseScaV1Scores(body.scores);
    } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'invalid scores' }, 400);
    }

    const defects =
        typeof body.defects === 'number' && Number.isInteger(body.defects) && body.defects >= 0 ? body.defects : 0;
    const totalScore = totalScoreScaV1(scores, defects);
    const cuppedBy = (body.cuppedBy?.trim() || 'Anonymous').slice(0, 80);
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;
    const descriptors = normalizeDescriptors(body.descriptors);

    const supabase = serviceClient();

    // ── Invite path (public token) ──
    if (body.token?.trim()) {
        const token = body.token.trim();
        const { data: invite, error } = await supabase
            .from('cupping_invites')
            .select(
                'id, user_id, roast_session_id, sample_id, event_id, expires_at, max_uses, used_count, revoked_at',
            )
            .eq('token', token)
            .maybeSingle();

        if (error) {
            console.error('[submit-cupping] invite', error);
            return jsonResponse({ error: 'lookup failed' }, 500);
        }
        if (!invite) return jsonResponse({ error: 'not_found' }, 404);
        if (invite.revoked_at) return jsonResponse({ error: 'revoked' }, 410);
        if (new Date(invite.expires_at) <= new Date()) return jsonResponse({ error: 'expired' }, 410);

        let roastSessionId = invite.roast_session_id as string | null;
        let sampleId = (body.sampleId?.trim() || invite.sample_id) as string | null;
        let profileId: string | null = null;
        let resolvedEventId = invite.event_id as string | null;

        // Event-level invite: sample must belong to that event
        if (invite.event_id) {
            if (!sampleId) return jsonResponse({ error: 'sampleId required' }, 400);
            const { data: sample, error: sampleErr } = await supabase
                .from('cupping_samples')
                .select('id, roast_session_id, event_id')
                .eq('id', sampleId)
                .eq('event_id', invite.event_id)
                .maybeSingle();
            if (sampleErr || !sample) return jsonResponse({ error: 'sample_not_found' }, 404);
            roastSessionId = sample.roast_session_id ?? roastSessionId;
        } else if (invite.sample_id) {
            // Legacy per-sample invite: ignore body.sampleId override to other samples
            sampleId = invite.sample_id;
            const { data: sample } = await supabase
                .from('cupping_samples')
                .select('id, roast_session_id, event_id')
                .eq('id', sampleId)
                .maybeSingle();
            if (sample?.roast_session_id) roastSessionId = sample.roast_session_id;
            if (sample?.event_id) resolvedEventId = sample.event_id;
        } else if (sampleId) {
            const { data: sample } = await supabase
                .from('cupping_samples')
                .select('id, roast_session_id, event_id')
                .eq('id', sampleId)
                .maybeSingle();
            if (!sample) return jsonResponse({ error: 'sample_not_found' }, 404);
            roastSessionId = sample.roast_session_id ?? roastSessionId;
            if (sample.event_id) resolvedEventId = sample.event_id;
        }

        if (resolvedEventId) {
            const { data: event } = await supabase
                .from('cupping_events')
                .select('ended_at')
                .eq('id', resolvedEventId)
                .maybeSingle();
            if (event?.ended_at) return jsonResponse({ error: 'ended' }, 410);
        }

        if (!sampleId && !roastSessionId) {
            return jsonResponse({ error: 'sampleId required' }, 400);
        }

        if (roastSessionId) {
            const { data: session } = await supabase
                .from('roast_sessions')
                .select('id, profile_id')
                .eq('id', roastSessionId)
                .maybeSingle();
            profileId = session?.profile_id ?? null;
        }

        // Upsert: same cupper + sample on this invite → update, no seat burn
        if (sampleId) {
            const { data: existing, error: exErr } = await supabase
                .from('cuppings')
                .select('id, total_score, cupped_at')
                .eq('invite_id', invite.id)
                .eq('sample_id', sampleId)
                .eq('cupped_by', cuppedBy)
                .order('cupped_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (exErr) {
                console.error('[submit-cupping] existing lookup', exErr);
                return jsonResponse({ error: 'lookup failed' }, 500);
            }
            if (existing) {
                const { data: row, error: updErr } = await supabase
                    .from('cuppings')
                    .update({
                        roast_session_id: roastSessionId,
                        roast_profile_id: profileId,
                        scores,
                        total_score: totalScore,
                        defects,
                        notes,
                        descriptors,
                        form_version: 'sca_v1',
                    })
                    .eq('id', existing.id)
                    .select('id, total_score, cupped_at')
                    .single();
                if (updErr || !row) {
                    console.error('[submit-cupping] update', updErr);
                    return jsonResponse({ error: 'update failed' }, 500);
                }
                return jsonResponse({ id: row.id, totalScore: row.total_score, cuppedAt: row.cupped_at }, 200);
            }
        }

        // Seat = unique cupper on invite (any sample already submitted under same name)
        const { data: priorCupper, error: priorErr } = await supabase
            .from('cuppings')
            .select('id')
            .eq('invite_id', invite.id)
            .eq('cupped_by', cuppedBy)
            .limit(1)
            .maybeSingle();
        if (priorErr) {
            console.error('[submit-cupping] prior cupper', priorErr);
            return jsonResponse({ error: 'lookup failed' }, 500);
        }
        const needsSeat = !priorCupper;

        let consumedFrom: number | null = null;
        if (needsSeat) {
            if (invite.used_count >= invite.max_uses) {
                return jsonResponse({ error: 'full' }, 410);
            }
            for (let attempt = 0; attempt < 12; attempt++) {
                const { data: current, error: curErr } = await supabase
                    .from('cupping_invites')
                    .select('id, used_count, max_uses, revoked_at, expires_at')
                    .eq('id', invite.id)
                    .maybeSingle();
                if (curErr || !current) {
                    return jsonResponse({ error: 'lookup failed' }, 500);
                }
                if (current.revoked_at) return jsonResponse({ error: 'revoked' }, 410);
                if (new Date(current.expires_at) <= new Date()) return jsonResponse({ error: 'expired' }, 410);
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
                    return jsonResponse({ error: 'lookup failed' }, 500);
                }
                if (bumped) {
                    consumedFrom = current.used_count;
                    break;
                }
            }
            if (consumedFrom == null) {
                return jsonResponse({ error: 'full' }, 410);
            }
        } else {
            // Returning cupper: still reject revoked/expired, but do not burn seats
            const { data: current, error: curErr } = await supabase
                .from('cupping_invites')
                .select('revoked_at, expires_at')
                .eq('id', invite.id)
                .maybeSingle();
            if (curErr || !current) return jsonResponse({ error: 'lookup failed' }, 500);
            if (current.revoked_at) return jsonResponse({ error: 'revoked' }, 410);
            if (new Date(current.expires_at) <= new Date()) return jsonResponse({ error: 'expired' }, 410);
        }

        const { data: row, error: insertErr } = await supabase
            .from('cuppings')
            .insert({
                user_id: invite.user_id,
                roast_session_id: roastSessionId,
                sample_id: sampleId,
                roast_profile_id: profileId,
                scores,
                total_score: totalScore,
                defects,
                cupped_by: cuppedBy,
                notes,
                descriptors,
                source: 'invite',
                invite_id: invite.id,
                form_version: 'sca_v1',
            })
            .select('id, total_score, cupped_at')
            .single();

        if (insertErr || !row) {
            console.error('[submit-cupping] insert', insertErr);
            if (consumedFrom != null) {
                await supabase
                    .from('cupping_invites')
                    .update({ used_count: consumedFrom })
                    .eq('id', invite.id)
                    .eq('used_count', consumedFrom + 1);
            }
            return jsonResponse({ error: 'insert failed' }, 500);
        }

        return jsonResponse({ id: row.id, totalScore: row.total_score, cuppedAt: row.cupped_at }, 201);
    }

    // ── Owner path (JWT) ──
    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const sampleId = body.sampleId?.trim() || null;
    let roastSessionId = body.roastSessionId?.trim() || null;
    let profileId: string | null = null;

    if (sampleId) {
        const { data: sample, error: sampleErr } = await supabase
            .from('cupping_samples')
            .select('id, roast_session_id, user_id')
            .eq('id', sampleId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (sampleErr || !sample) return jsonResponse({ error: 'sample_not_found' }, 404);
        roastSessionId = sample.roast_session_id ?? roastSessionId;
    }

    if (roastSessionId) {
        const { data: session, error: sessionErr } = await supabase
            .from('roast_sessions')
            .select('id, profile_id, user_id')
            .eq('id', roastSessionId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (sessionErr || !session) return jsonResponse({ error: 'session_not_found' }, 404);
        profileId = session.profile_id;
    }

    if (!sampleId && !roastSessionId) {
        return jsonResponse({ error: 'sampleId or roastSessionId required' }, 400);
    }

    const source = body.source === 'web' ? 'web' : 'desktop';

    const { data: row, error: insertErr } = await supabase
        .from('cuppings')
        .insert({
            user_id: user.id,
            roast_session_id: roastSessionId,
            sample_id: sampleId,
            roast_profile_id: profileId,
            scores,
            total_score: totalScore,
            defects,
            cupped_by: cuppedBy,
            notes,
            descriptors,
            source,
            form_version: 'sca_v1',
        })
        .select('id, total_score, cupped_at')
        .single();

    if (insertErr || !row) {
        console.error('[submit-cupping] owner insert', insertErr);
        return jsonResponse({ error: 'insert failed' }, 500);
    }

    return jsonResponse({ id: row.id, totalScore: row.total_score, cuppedAt: row.cupped_at }, 201);
});
