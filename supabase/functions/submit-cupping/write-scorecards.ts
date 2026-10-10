export type ScorecardWrite = {
    sample: { id: string; roast_session_id: string | null };
    scores: Record<string, unknown>;
    totalScore: number;
    defects: number;
    notes: string | null;
    descriptors: string[];
    formVersion: string;
};

export type WrittenRow = {
    id: string;
    sampleId: string;
    totalScore: number;
    cuppedAt: string;
    created: boolean;
};

type RpcResult = {
    data: Array<{
        id: string;
        sample_id: string;
        total_score: number | string;
        cupped_at: string;
        created: boolean;
    }> | null;
    error: unknown;
};

type RpcClient = {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

export async function writeScorecardsBatch(
    supabase: RpcClient,
    invite: { id: string; roast_session_id: string | null },
    participantId: string,
    cuppedBy: string,
    publish: boolean,
    cards: ScorecardWrite[],
): Promise<WrittenRow[]> {
    const { data, error } = await supabase.rpc('write_cupping_scorecards_batch', {
        p_invite_id: invite.id,
        p_participant_id: participantId,
        p_cupped_by: cuppedBy,
        p_publish: publish,
        p_cards: cards.map((card) => ({
            sample_id: card.sample.id,
            roast_session_id: card.sample.roast_session_id ?? invite.roast_session_id,
            scores: card.scores,
            total_score: card.totalScore,
            defects: card.defects,
            notes: card.notes,
            descriptors: card.descriptors,
            form_version: card.formVersion,
        })),
    });
    if (error) throw error;
    if (!data || data.length !== cards.length) throw new Error('scorecard batch result mismatch');
    return data.map((row, index) => {
        const totalScore = Number(row.total_score);
        if (
            row.sample_id !== cards[index].sample.id ||
            !row.id ||
            !row.cupped_at ||
            !Number.isFinite(totalScore) ||
            typeof row.created !== 'boolean'
        ) {
            throw new Error('scorecard batch result mismatch');
        }
        return {
            id: row.id,
            sampleId: row.sample_id,
            totalScore,
            cuppedAt: row.cupped_at,
            created: row.created,
        };
    });
}
