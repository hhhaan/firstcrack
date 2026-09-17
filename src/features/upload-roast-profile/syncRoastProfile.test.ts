import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncRoastProfile } from './useUploadRoastProfile';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
    update: vi.fn(),
    upload: vi.fn(),
    uploadBbp: vi.fn(),
    flush: vi.fn(),
    deleteMain: vi.fn(),
    deleteBbp: vi.fn(),
}));
vi.mock('@entities/roast', () => ({
    roastSessionApi: { find: mocks.find, update: mocks.update },
    patchRoastSessionTsvPaths: vi.fn(),
}));
vi.mock('@shared/lib/tsv-writer', () => ({
    flushTsv: mocks.flush,
    deleteSessionTsv: mocks.deleteMain,
    deleteBbpTsv: mocks.deleteBbp,
}));
vi.mock('./uploadRoastProfile', () => ({ uploadRoastProfile: mocks.upload, uploadBbpProfile: mocks.uploadBbp }));

const input = {
    sessionId: 'session',
    roastSessionId: 'session',
    ownerId: 'owner',
    profileRequired: true,
    bbpRequired: true,
};
const saved = {
    id: 'session',
    user_id: 'owner',
    status: 'completed',
    tsv_path: null as string | null,
    bbp_tsv_path: null as string | null,
};
let row = { ...saved };
beforeEach(() => {
    vi.resetAllMocks();
    row = { ...saved };
    mocks.find.mockImplementation(async () => ({ ...row }));
    mocks.update.mockImplementation(async (patch) => {
        row = { ...row, ...patch };
        return { ...row };
    });
    mocks.upload.mockResolvedValue('main-key');
    mocks.uploadBbp.mockResolvedValue('bbp-key');
});

describe('artifact recovery', () => {
    it('preserves BBP failure and resumes only BBP with the explicit owner', async () => {
        mocks.uploadBbp.mockRejectedValueOnce(new Error('network'));
        await expect(syncRoastProfile(input)).rejects.toThrow('network');
        expect(row.tsv_path).toBe('main-key');
        expect(mocks.deleteMain).toHaveBeenCalledOnce();
        expect(mocks.deleteBbp).not.toHaveBeenCalled();
        await expect(syncRoastProfile(input)).resolves.toEqual({ key: 'main-key', bbpKey: 'bbp-key' });
        expect(mocks.upload).toHaveBeenCalledExactlyOnceWith('session', 'owner');
        expect(mocks.flush).toHaveBeenCalledOnce();
        expect(mocks.uploadBbp).toHaveBeenLastCalledWith('session', 'owner');
        expect(mocks.update.mock.calls).toEqual([
            [{ id: 'session', tsv_path: 'main-key' }],
            [{ id: 'session', bbp_tsv_path: 'bbp-key' }],
        ]);
    });

    it.each(['paths', 'not-required'])(
        'does no local I/O when %s already resolve the artifact intent',
        async (mode) => {
            if (mode === 'paths') row = { ...row, tsv_path: 'main-key', bbp_tsv_path: 'bbp-key' };
            await syncRoastProfile({ ...input, profileRequired: mode === 'paths', bbpRequired: mode === 'paths' });
            for (const fn of [
                mocks.flush,
                mocks.upload,
                mocks.uploadBbp,
                mocks.update,
                mocks.deleteMain,
                mocks.deleteBbp,
            ])
                expect(fn).not.toHaveBeenCalled();
        },
    );

    it('does not clean up before path confirmation and recovers a lost DB response without reading local files', async () => {
        mocks.update.mockImplementationOnce(async (patch) => {
            row = { ...row, ...patch };
            throw new Error('response lost');
        });
        await expect(syncRoastProfile({ ...input, bbpRequired: false })).rejects.toThrow('response lost');
        expect(mocks.deleteMain).not.toHaveBeenCalled();
        await syncRoastProfile({ ...input, bbpRequired: false });
        expect(mocks.upload).toHaveBeenCalledOnce();
        expect(mocks.flush).toHaveBeenCalledOnce();
    });

    it('does not delete a file when the DB response lacks the requested path', async () => {
        mocks.update.mockResolvedValueOnce({ ...row });
        await expect(syncRoastProfile(input)).rejects.toThrow('not confirmed');
        expect(mocks.deleteMain).not.toHaveBeenCalled();
        expect(mocks.uploadBbp).not.toHaveBeenCalled();
    });

    it.each(['main', 'bbp'])('rejects a missing required %s file', async (artifact) => {
        if (artifact === 'main') mocks.upload.mockResolvedValue(null);
        else {
            row.tsv_path = 'main-key';
            mocks.uploadBbp.mockResolvedValue(null);
        }
        await expect(syncRoastProfile(input)).rejects.toThrow('TSV missing');
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it.each(['id', 'owner', 'status', 'absent', 'input'])(
        'rejects %s mismatch before any artifact I/O',
        async (kind) => {
            if (kind === 'id') row.id = 'different';
            if (kind === 'owner') row.user_id = 'different';
            if (kind === 'status') row.status = 'pending';
            if (kind === 'absent') mocks.find.mockResolvedValue(null);
            await expect(
                syncRoastProfile({ ...input, sessionId: kind === 'input' ? 'different' : input.sessionId }),
            ).rejects.toThrow('session mismatch');
            expect(mocks.upload).not.toHaveBeenCalled();
            expect(mocks.flush).not.toHaveBeenCalled();
            expect(mocks.update).not.toHaveBeenCalled();
        },
    );

    it('keeps DB read failures and flush errors visible without uploading', async () => {
        mocks.find.mockRejectedValueOnce(new Error('DB offline'));
        await expect(syncRoastProfile(input)).rejects.toThrow('DB offline');
        mocks.flush.mockRejectedValueOnce(new Error('partial append'));
        await expect(syncRoastProfile(input)).rejects.toThrow('partial append');
        expect(mocks.upload).not.toHaveBeenCalled();
    });
});
