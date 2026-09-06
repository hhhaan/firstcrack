import { describe, expect, it } from 'vitest';
import { classifySidecarConnection } from './classify-sidecar-connection';

describe('classifySidecarConnection', () => {
    it('live temperature sample stays connected', () => {
        expect(classifySidecarConnection({ kind: 'live' })).toEqual({
            connected: true,
            reconnecting: false,
            error: null,
        });
    });

    it('null BT while hardware reconnecting holds session connected', () => {
        // Failure mode: old path setConnected(false) → preheating/standby reset
        expect(
            classifySidecarConnection({
                kind: 'null_bt',
                dataReconnecting: true,
                status: { connected: false, reconnecting: true, error: 'read failed' },
            }),
        ).toEqual({
            connected: true,
            reconnecting: true,
            error: 'read failed',
        });
    });

    it('null BT with idle disconnect is hard disconnect', () => {
        expect(
            classifySidecarConnection({
                kind: 'null_bt',
                status: { connected: false, reconnecting: false, error: null },
            }),
        ).toEqual({
            connected: false,
            reconnecting: false,
            error: null,
        });
    });

    it('null BT but status still connected holds session', () => {
        expect(
            classifySidecarConnection({
                kind: 'null_bt',
                status: { connected: true, reconnecting: false, error: null },
            }),
        ).toEqual({
            connected: true,
            reconnecting: false,
            error: null,
        });
    });

    it('poll throw while status reconnecting holds session (does not clear reconnecting)', () => {
        // Failure mode: catch {} always setReconnecting(false) + setConnected(false)
        expect(
            classifySidecarConnection({
                kind: 'poll_error',
                status: { connected: false, reconnecting: true, error: 'timeout' },
            }),
        ).toEqual({
            connected: true,
            reconnecting: true,
            error: 'timeout',
        });
    });

    it('poll throw while status still connected holds session', () => {
        expect(
            classifySidecarConnection({
                kind: 'poll_error',
                status: { connected: true, reconnecting: false, error: null },
            }),
        ).toEqual({
            connected: true,
            reconnecting: false,
            error: null,
        });
    });

    it('poll throw with unreachable status is hard disconnect', () => {
        expect(
            classifySidecarConnection({
                kind: 'poll_error',
                status: null,
            }),
        ).toEqual({
            connected: false,
            reconnecting: false,
            error: null,
        });
    });

    it('idle status poll: not connected and not reconnecting → hard disconnect', () => {
        expect(
            classifySidecarConnection({
                kind: 'null_bt',
                status: { connected: false, reconnecting: false, error: 'gone' },
            }),
        ).toEqual({
            connected: false,
            reconnecting: false,
            error: 'gone',
        });
    });
});
