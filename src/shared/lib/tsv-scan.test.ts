import { describe, expect, it } from 'vitest';
import { pairLocalTsvsToSessions, parseLocalTsvFilename } from './tsv-scan';

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('parseLocalTsvFilename', () => {
    it('extracts UUID from session_*.tsv', () => {
        expect(parseLocalTsvFilename(`session_${UUID}.tsv`)).toEqual({
            kind: 'session',
            sessionId: UUID,
            filename: `session_${UUID}.tsv`,
        });
    });

    it('extracts UUID from bbp_*.tsv', () => {
        expect(parseLocalTsvFilename(`bbp_${UUID}.tsv`)).toEqual({
            kind: 'bbp',
            sessionId: UUID,
            filename: `bbp_${UUID}.tsv`,
        });
    });

    it('normalizes uppercase UUID to lowercase', () => {
        const upper = UUID.toUpperCase();
        expect(parseLocalTsvFilename(`session_${upper}.tsv`)).toEqual({
            kind: 'session',
            sessionId: UUID,
            filename: `session_${upper}.tsv`,
        });
    });

    it('rejects non-UUID session ids', () => {
        expect(parseLocalTsvFilename('session_abc.tsv')).toBeNull();
        expect(parseLocalTsvFilename('session_not-a-uuid.tsv')).toBeNull();
    });

    it('rejects wrong prefix, extension, or extra path', () => {
        expect(parseLocalTsvFilename(`session_${UUID}.txt`)).toBeNull();
        expect(parseLocalTsvFilename(`curve_${UUID}.tsv`)).toBeNull();
        expect(parseLocalTsvFilename(`dir/session_${UUID}.tsv`)).toBeNull();
        expect(parseLocalTsvFilename(`session_${UUID}.tsv.bak`)).toBeNull();
        expect(parseLocalTsvFilename('')).toBeNull();
        expect(parseLocalTsvFilename('notes.txt')).toBeNull();
    });
});

describe('pairLocalTsvsToSessions', () => {
    const owner = 'owner-1';
    const other = 'owner-2';

    const sessionFile = (id: string) => ({
        kind: 'session' as const,
        sessionId: id,
        filename: `session_${id}.tsv`,
    });
    const bbpFile = (id: string) => ({
        kind: 'bbp' as const,
        sessionId: id,
        filename: `bbp_${id}.tsv`,
    });

    it('queues upload when session exists and tsv_path is null', () => {
        const plan = pairLocalTsvsToSessions(
            [sessionFile(UUID)],
            [{ id: UUID, tsv_path: null, user_id: owner }],
            owner,
        );
        expect(plan.needsUpload).toEqual([{ sessionId: UUID, roastSessionId: UUID }]);
        expect(plan.unmatched).toEqual([]);
    });

    it('treats empty tsv_path as missing', () => {
        const plan = pairLocalTsvsToSessions([sessionFile(UUID)], [{ id: UUID, tsv_path: '', user_id: owner }], owner);
        expect(plan.needsUpload).toHaveLength(1);
    });

    it('skips sessions that already have tsv_path', () => {
        const plan = pairLocalTsvsToSessions(
            [sessionFile(UUID)],
            [{ id: UUID, tsv_path: `profiles/${owner}/${UUID}.tsv`, user_id: owner }],
            owner,
        );
        expect(plan.needsUpload).toEqual([]);
        expect(plan.unmatched).toEqual([]);
    });

    it('lists files with no session row as unmatched', () => {
        const plan = pairLocalTsvsToSessions([sessionFile(UUID), bbpFile(UUID)], [], owner);
        expect(plan.needsUpload).toEqual([]);
        expect(plan.unmatched).toEqual([{ sessionId: UUID, hasSessionTsv: true, hasBbpTsv: true }]);
    });

    it('pairs session + bbp files for the same UUID', () => {
        const plan = pairLocalTsvsToSessions(
            [sessionFile(UUID), bbpFile(UUID), sessionFile(UUID_B)],
            [
                { id: UUID, tsv_path: null, user_id: owner },
                { id: UUID_B, tsv_path: null, user_id: owner },
            ],
            owner,
        );
        expect(plan.needsUpload).toEqual([
            { sessionId: UUID, roastSessionId: UUID },
            { sessionId: UUID_B, roastSessionId: UUID_B },
        ]);
        expect(plan.unmatched).toEqual([]);
    });

    it('does not queue upload for bbp-only when session tsv is missing', () => {
        const plan = pairLocalTsvsToSessions([bbpFile(UUID)], [{ id: UUID, tsv_path: null, user_id: owner }], owner);
        expect(plan.needsUpload).toEqual([]);
        expect(plan.unmatched).toEqual([]);
    });

    it('shows bbp-only files with no session row as unmatched', () => {
        const plan = pairLocalTsvsToSessions([bbpFile(UUID)], [], owner);
        expect(plan.unmatched).toEqual([{ sessionId: UUID, hasSessionTsv: false, hasBbpTsv: true }]);
    });

    it('skips other-workspace sessions instead of treating them as unmatched', () => {
        const plan = pairLocalTsvsToSessions(
            [sessionFile(UUID), sessionFile(UUID_B)],
            [
                { id: UUID, tsv_path: null, user_id: other },
                { id: UUID_B, tsv_path: null, user_id: owner },
            ],
            owner,
        );
        expect(plan.needsUpload).toEqual([{ sessionId: UUID_B, roastSessionId: UUID_B }]);
        expect(plan.unmatched).toEqual([]);
    });

    it('matches session ids case-insensitively and keeps roastSessionId casing', () => {
        const mixed = UUID.toUpperCase();
        const plan = pairLocalTsvsToSessions(
            [sessionFile(UUID)],
            [{ id: mixed, tsv_path: null, user_id: owner }],
            owner,
        );
        expect(plan.needsUpload).toEqual([{ sessionId: UUID, roastSessionId: mixed }]);
    });

    it('feeds parseLocalTsvFilename output into pairing without a mock', () => {
        const parsed = ['session_', 'bbp_'].flatMap((prefix) => {
            const file = parseLocalTsvFilename(`${prefix}${UUID}.tsv`);
            expect(file).not.toBeNull();
            return file ? [file] : [];
        });
        const plan = pairLocalTsvsToSessions(parsed, [{ id: UUID, tsv_path: null, user_id: owner }], owner);
        expect(plan.needsUpload).toEqual([{ sessionId: UUID, roastSessionId: UUID }]);
        expect(plan.unmatched).toEqual([]);
    });

    it('splits upload, unmatched, and already-synced in one pass', () => {
        const plan = pairLocalTsvsToSessions(
            [sessionFile(UUID), sessionFile(UUID_B), sessionFile(UUID_C)],
            [
                { id: UUID, tsv_path: null, user_id: owner },
                { id: UUID_B, tsv_path: `profiles/${owner}/${UUID_B}.tsv`, user_id: owner },
            ],
            owner,
        );
        expect(plan.needsUpload).toEqual([{ sessionId: UUID, roastSessionId: UUID }]);
        expect(plan.unmatched).toEqual([{ sessionId: UUID_C, hasSessionTsv: true, hasBbpTsv: false }]);
    });
});
