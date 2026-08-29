import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/auth.ts';
import { SCA_V1_KEYS } from '../_shared/cupping-score.ts';
import { respondServerError, serveWithSentry } from '../_shared/sentry.ts';

const serviceClient = () =>
    createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

type BeanMeta = {
    name: string | null;
    origin: string | null;
    region: string | null;
    variety: string | null;
    process: string | null;
    farm: string | null;
};

function beanMetaLine(b: BeanMeta | null | undefined): string | null {
    if (!b) return null;
    const line = [b.origin, b.region, b.variety, b.process, b.farm].filter(Boolean).join(' · ');
    return line || null;
}

function avg(nums: number[]): number | null {
    if (!nums.length) return null;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function generateToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

serveWithSentry('get-cupping-results', async (req) => {
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

    // 1) Primary: results_token on event
    let event: {
        id: string;
        title: string;
        held_at: string;
        ended_at: string | null;
        results_token: string | null;
    } | null = null;

    {
        const { data, error } = await supabase
            .from('cupping_events')
            .select('id, title, held_at, ended_at, results_token')
            .eq('results_token', token)
            .maybeSingle();
        if (error) {
            console.error('[get-cupping-results] event by results_token', error);
            return respondServerError('get-cupping-results', 'lookup failed', error);
        }
        event = data;
    }

    // 2) Fallback: invite token (revoked OK) → same event after end
    if (!event) {
        const { data: invite, error: invErr } = await supabase
            .from('cupping_invites')
            .select('event_id, sample_id')
            .eq('token', token)
            .maybeSingle();
        if (invErr) {
            console.error('[get-cupping-results] invite', invErr);
            return respondServerError('get-cupping-results', 'lookup failed', invErr);
        }
        if (!invite) return jsonResponse({ error: 'not_found' }, 404);

        let eventId = invite.event_id as string | null;
        if (!eventId && invite.sample_id) {
            const { data: sample } = await supabase
                .from('cupping_samples')
                .select('event_id')
                .eq('id', invite.sample_id)
                .maybeSingle();
            eventId = sample?.event_id ?? null;
        }
        if (!eventId) return jsonResponse({ error: 'not_found' }, 404);

        const { data, error } = await supabase
            .from('cupping_events')
            .select('id, title, held_at, ended_at, results_token')
            .eq('id', eventId)
            .maybeSingle();
        if (error) {
            console.error('[get-cupping-results] event by invite', error);
            return respondServerError('get-cupping-results', 'lookup failed', error);
        }
        event = data;
    }

    if (!event) return jsonResponse({ error: 'not_found' }, 404);
    if (!event.ended_at) return jsonResponse({ error: 'not_ended' }, 409);

    // Lazy mint results_token for sessions ended before this feature
    let resultsToken = event.results_token;
    if (!resultsToken) {
        resultsToken = generateToken();
        const { data: updated, error: upErr } = await supabase
            .from('cupping_events')
            .update({ results_token: resultsToken, updated_at: new Date().toISOString() })
            .eq('id', event.id)
            .is('results_token', null)
            .select('results_token')
            .maybeSingle();
        if (upErr) {
            console.error('[get-cupping-results] mint token', upErr);
            return respondServerError('get-cupping-results', 'lookup failed', upErr);
        }
        resultsToken = updated?.results_token ?? resultsToken;
        if (!updated?.results_token) {
            const { data: again } = await supabase
                .from('cupping_events')
                .select('results_token')
                .eq('id', event.id)
                .maybeSingle();
            resultsToken = again?.results_token ?? resultsToken;
        }
    }

    const { data: sampleRows, error: sErr } = await supabase
        .from('cupping_samples')
        .select('id, label, sort_order, roast_session_id')
        .eq('event_id', event.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
    if (sErr) {
        console.error('[get-cupping-results] samples', sErr);
        return respondServerError('get-cupping-results', 'lookup failed', sErr);
    }

    const samples = sampleRows ?? [];
    const sampleIds = samples.map((s) => s.id);
    const roastIds = [...new Set(samples.map((s) => s.roast_session_id).filter(Boolean))] as string[];
    const beanByRoast = new Map<string, BeanMeta>();
    if (roastIds.length) {
        const { data: sessions } = await supabase
            .from('roast_sessions')
            .select('id, beans(name, origin, region, variety, process, farm)')
            .in('id', roastIds);
        for (const s of sessions ?? []) {
            const beans = s.beans as BeanMeta | null;
            if (beans) beanByRoast.set(s.id, beans);
        }
    }

    type ScoreRow = {
        sample_id: string | null;
        total_score: number;
        cupped_by: string | null;
        descriptors: string[] | null;
        scores: Record<string, number> | null;
        cupped_at: string;
    };

    let scoreRows: ScoreRow[] = [];
    if (sampleIds.length) {
        const { data: scores, error: cErr } = await supabase
            .from('cuppings')
            .select('sample_id, total_score, cupped_by, descriptors, scores, cupped_at')
            .in('sample_id', sampleIds)
            .order('cupped_at', { ascending: true });
        if (cErr) {
            console.error('[get-cupping-results] scores', cErr);
            return respondServerError('get-cupping-results', 'lookup failed', cErr);
        }
        scoreRows = (scores ?? []) as ScoreRow[];
    }

    const bySample = new Map<string, ScoreRow[]>();
    const participantSet = new Set<string>();
    const allTotals: number[] = [];
    for (const row of scoreRows) {
        if (!row.sample_id) continue;
        const list = bySample.get(row.sample_id) ?? [];
        list.push(row);
        bySample.set(row.sample_id, list);
        allTotals.push(Number(row.total_score));
        const name = (row.cupped_by ?? '').trim();
        participantSet.add(name || '');
    }

    const sampleOut = samples.map((s) => {
        const rows = bySample.get(s.id) ?? [];
        const totals = rows.map((r) => Number(r.total_score));
        const attrAvgs: Record<string, number | null> = {};
        for (const key of SCA_V1_KEYS) {
            const vals = rows
                .map((r) => {
                    const v = r.scores?.[key];
                    return typeof v === 'number' ? v : null;
                })
                .filter((v): v is number => v != null);
            attrAvgs[key] = avg(vals);
        }

        const descCount = new Map<string, number>();
        for (const r of rows) {
            const tags = Array.isArray(r.descriptors) ? r.descriptors : [];
            for (const raw of tags) {
                const t = String(raw).trim().toLowerCase();
                if (!t) continue;
                descCount.set(t, (descCount.get(t) ?? 0) + 1);
            }
        }
        const topDescriptors = [...descCount.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 8)
            .map(([tag, count]) => ({ tag, count }));

        const bean = s.roast_session_id ? (beanByRoast.get(s.roast_session_id) ?? null) : null;

        return {
            id: s.id,
            label: s.label,
            sortOrder: s.sort_order,
            beanName: bean?.name ?? null,
            beanMeta: beanMetaLine(bean),
            scoreCount: rows.length,
            avgTotal: avg(totals),
            avgScores: attrAvgs,
            topDescriptors,
            cuppers: rows.map((r) => ({
                cuppedBy: (r.cupped_by ?? '').trim() || 'Anonymous',
                totalScore: Number(r.total_score),
                descriptors: Array.isArray(r.descriptors)
                    ? r.descriptors.map((d) => String(d)).filter(Boolean)
                    : [],
                cuppedAt: r.cupped_at,
            })),
        };
    });

    // Rank by avg total (nulls last)
    const ranked = [...sampleOut].sort((a, b) => {
        if (a.avgTotal == null && b.avgTotal == null) return a.sortOrder - b.sortOrder;
        if (a.avgTotal == null) return 1;
        if (b.avgTotal == null) return -1;
        return b.avgTotal - a.avgTotal || a.sortOrder - b.sortOrder;
    });

    return jsonResponse({
        eventId: event.id,
        eventTitle: event.title,
        heldAt: event.held_at,
        endedAt: event.ended_at,
        resultsToken,
        scoreCount: allTotals.length,
        participantCount: participantSet.size,
        overallAvg: avg(allTotals),
        samples: ranked,
    });
});
