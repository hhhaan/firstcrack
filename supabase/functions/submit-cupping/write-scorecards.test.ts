import { describe, expect, it, vi } from 'vitest';
import { writeScorecardsBatch } from './write-scorecards';

const cards = [
    {
        sample: { id: 'sample-2', roast_session_id: 'session-2' },
        scores: { aroma: 8 },
        totalScore: 84,
        defects: 0,
        notes: 'bright',
        descriptors: ['citrus'],
        formVersion: 'sca_v1',
    },
    {
        sample: { id: 'sample-1', roast_session_id: null },
        scores: { aroma: 7 },
        totalScore: 80,
        defects: 1,
        notes: null,
        descriptors: [],
        formVersion: 'sca_v1',
    },
];

describe('writeScorecardsBatch', () => {
    it('writes mixed cards once and preserves the RPC response order and flags', async () => {
        const rpc = vi.fn().mockResolvedValue({
            error: null,
            data: [
                { id: 'old', sample_id: 'sample-2', total_score: '84.00', cupped_at: 'first', created: false },
                { id: 'new', sample_id: 'sample-1', total_score: 80, cupped_at: 'now', created: true },
            ],
        });

        await expect(
            writeScorecardsBatch(
                { rpc },
                { id: 'invite-1', roast_session_id: 'fallback' },
                'participant-1',
                'Cupper',
                true,
                cards,
            ),
        ).resolves.toEqual([
            { id: 'old', sampleId: 'sample-2', totalScore: 84, cuppedAt: 'first', created: false },
            { id: 'new', sampleId: 'sample-1', totalScore: 80, cuppedAt: 'now', created: true },
        ]);
        expect(rpc).toHaveBeenCalledOnce();
        expect(rpc).toHaveBeenCalledWith(
            'write_cupping_scorecards_batch',
            expect.objectContaining({
                p_invite_id: 'invite-1',
                p_participant_id: 'participant-1',
                p_cupped_by: 'Cupper',
                p_publish: true,
                p_cards: [
                    expect.objectContaining({ sample_id: 'sample-2', roast_session_id: 'session-2' }),
                    expect.objectContaining({ sample_id: 'sample-1', roast_session_id: 'fallback' }),
                ],
            }),
        );
    });

    it('propagates transaction errors and rejects incomplete responses', async () => {
        const error = { code: '22023', message: 'wrong scope' };
        await expect(
            writeScorecardsBatch(
                { rpc: vi.fn().mockResolvedValue({ data: null, error }) },
                { id: 'invite-1', roast_session_id: null },
                'participant-1',
                'Cupper',
                false,
                cards,
            ),
        ).rejects.toEqual(error);
        await expect(
            writeScorecardsBatch(
                { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
                { id: 'invite-1', roast_session_id: null },
                'participant-1',
                'Cupper',
                false,
                cards,
            ),
        ).rejects.toThrow('scorecard batch result mismatch');

        await expect(
            writeScorecardsBatch(
                {
                    rpc: vi.fn().mockResolvedValue({
                        error: null,
                        data: [
                            { id: 'wrong', sample_id: 'sample-1', total_score: 80, cupped_at: 'now', created: true },
                            { id: 'wrong-2', sample_id: 'sample-2', total_score: 84, cupped_at: 'now', created: false },
                        ],
                    }),
                },
                { id: 'invite-1', roast_session_id: null },
                'participant-1',
                'Cupper',
                false,
                cards,
            ),
        ).rejects.toThrow('scorecard batch result mismatch');
    });
});
