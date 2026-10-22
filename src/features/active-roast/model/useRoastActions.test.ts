// @vitest-environment jsdom
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useRoastActions } from './useRoastActions';

vi.mock('@shared/lib/sidecar', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sidecar')>();
    return {
        ...actual,
        sidecar: {
            ...actual.sidecar,
            getStatus: vi.fn().mockResolvedValue({
                connected: true,
                sensor_clock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
                connection_epoch: 1,
                heater_control: { generation: 7 },
            }),
            startRoast: vi
                .fn()
                .mockImplementation(
                    async (request?: {
                        session_id: string;
                        origin:
                            | { kind: 'now' }
                            | { kind: 'sample'; sample: { sensor_clock: string; acquired_at: number } };
                    }) =>
                        request
                            ? {
                                  ok: true,
                                  charge: {
                                      session_id: request.session_id,
                                      charge_id: 'charge-1',
                                      machine: { machine_id: 'machine-1', roaster_key: 'virtual', protocol: 'virtual' },
                                      sensor_clock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
                                      connection_epoch: 1,
                                      acquired_at: 100,
                                      anchor: request.origin.kind === 'sample' ? request.origin.sample : null,
                                      origin_kind: request.origin.kind,
                                      accepted_at: 100,
                                      state: 'open',
                                      closed_reason: null,
                                  },
                                  server_time: 100,
                                  elapsed_sec: 0,
                              }
                            : { ok: true, charge: null, curve_eligible: false },
                ),
        },
    };
});

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-A' }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderActions = () => {
    const root = createRoot(document.createElement('div'));
    const setLogEntries = vi.fn();
    const onDrop = vi.fn();
    let latest: ReturnType<typeof useRoastActions>;

    const Probe = () => {
        latest = useRoastActions({
            unit: 'C',
            rawBT: 200,
            setLogEntries,
            onDrop,
            storeStartCharge: useRoastingStore.getState().startCharge,
        });
        return null;
    };

    void act(() => root.render(createElement(Probe)));
    return {
        setLogEntries,
        onDrop,
        get result() {
            return latest;
        },
    };
};

const resetStore = () => {
    useRoastingStore.getState().reset();
    useRoastingStore.setState({
        phase: 'standby',
        sessionId: null,
        roastStartMs: 0,
        elapsed: 0,
    });
};

describe('triggerCharge 이중 발화 가드 (#174 manual↔auto race)', () => {
    beforeEach(resetStore);

    it('2회 연속 호출해도 sessionId·기준점 불변, Charge 로그 1회', () => {
        const h = renderActions();

        void act(() => h.result.triggerCharge(200));
        const { sessionId, roastStartMs } = useRoastingStore.getState();
        expect(sessionId).not.toBeNull();

        // 2차 호출은 과거 chargeTimeMs를 줘도 (가드 실패 시 기준점이 이동하도록) 전부 무시돼야 한다
        void act(() => h.result.triggerCharge(195, Date.now() - 3000));
        const after = useRoastingStore.getState();
        expect(after.sessionId).toBe(sessionId);
        expect(after.roastStartMs).toBe(roastStartMs);
        expect(useRoastingStore.getState().logState.entries.filter((entry) => entry.event === 'Charge')).toHaveLength(
            1,
        );
        expect(useRoastingStore.getState().sessionOwnerId).toBe('owner-A');
    });

    it('manual Charge and a past auto-charge onset share one store origin', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-28T04:00:00.000Z'));
        try {
            const h = renderActions();
            void act(() => h.result.triggerCharge(200));
            const manual = useRoastingStore.getState().roastStartMs;
            expect(manual).toBe(Date.now());

            useRoastingStore.getState().reset();
            useRoastingStore.setState({ phase: 'standby' });
            const onset = Date.now() - 4_000;
            void act(() => h.result.triggerCharge(190, onset));
            expect(useRoastingStore.getState().roastStartMs).toBe(onset);
            expect(useRoastingStore.getState().elapsed).toBe(4);
            void act(() => h.result.triggerCharge(180, Date.now() - 9_000));
            expect(useRoastingStore.getState().roastStartMs).toBe(onset);
        } finally {
            vi.useRealTimers();
        }
    });

    it('sends the detected sample key and stores the accepted server Charge', async () => {
        const h = renderActions();
        const sample = {
            timestamp: 95,
            sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
            receivedAtMs: Date.now() - 5_000,
            bt: 190,
            processing: {
                algorithm_version: 'ema-least-squares-v1',
                temperature_unit: 'C',
                ror_unit: 'C/min',
                timestamp_clock: 'sidecar-monotonic-seconds',
                display_ema_alpha: 0.4,
                ror_ema_alpha: 0.3,
                ror_window_sec: 30,
                ror_warmup_reads: 3,
            },
        } as const;

        act(() => h.result.triggerCharge(190, sample));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        const state = useRoastingStore.getState();
        expect(sidecar.startRoast).toHaveBeenLastCalledWith({
            session_id: state.sessionId,
            sensor_clock: sample.sensorClock,
            connection_epoch: 1,
            expected_generation: 7,
            origin: {
                kind: 'sample',
                sample: { sensor_clock: sample.sensorClock, acquired_at: sample.timestamp },
            },
        });
        expect(state.chargeRequestPending).toBe(false);
        expect(state.chargeSample).toBe(sample);
        expect(state.acceptedCharge).toMatchObject({
            session_id: state.sessionId,
            anchor: { sensor_clock: sample.sensorClock, acquired_at: sample.timestamp },
            origin_kind: 'sample',
        });
    });

    it('keeps the legacy start path when modern status metadata is unavailable', async () => {
        vi.mocked(sidecar.getStatus).mockRejectedValueOnce(new Error('old sidecar'));
        vi.mocked(sidecar.startRoast).mockClear();
        const h = renderActions();

        act(() => h.result.triggerCharge(200));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(sidecar.startRoast).toHaveBeenCalledExactlyOnceWith();
        expect(useRoastingStore.getState()).toMatchObject({
            phase: 'roasting',
            acceptedCharge: null,
            chargeRequestPending: false,
        });
    });

    it('does not open an obsolete Charge after the local session resets during status lookup', async () => {
        let resolveStatus!: (status: Awaited<ReturnType<typeof sidecar.getStatus>>) => void;
        vi.mocked(sidecar.getStatus).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveStatus = resolve;
            }),
        );
        vi.mocked(sidecar.startRoast).mockClear();
        const h = renderActions();

        act(() => h.result.triggerCharge(200));
        act(() => useRoastingStore.getState().reset());
        await act(async () =>
            resolveStatus({
                connected: true,
                sensor_clock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
                connection_epoch: 1,
                heater_control: {
                    connection_epoch: 1,
                    generation: 7,
                    origin: 'manual',
                    pending_writes: 0,
                    uncertain: false,
                },
                roaster: 'virtual',
                display_name: 'Virtual',
                brand: 'First Crack',
                capabilities: [],
                uptime: 1,
                error: null,
            }),
        );

        expect(sidecar.startRoast).not.toHaveBeenCalled();
    });

    it('startRoast passes SidecarHttpError through so skip rules apply', async () => {
        const { SidecarHttpError } = await import('@shared/lib/sidecar');
        const sentry = await import('@shared/lib/sentry');
        const captureActionable = vi.spyOn(sentry, 'captureActionable').mockImplementation(() => undefined);
        vi.mocked(sidecar.startRoast).mockRejectedValueOnce(new SidecarHttpError('/start', 502, 'plc fail', false));
        const h = renderActions();
        await act(async () => h.result.triggerCharge(200));
        expect(captureActionable).not.toHaveBeenCalled();
        captureActionable.mockRestore();
    });

    it('startRoast forwards SidecarHttpError to logger.capture (skip rules apply to the same error)', async () => {
        const { SidecarHttpError } = await import('@shared/lib/sidecar');
        const captureSpy = vi.spyOn(logger, 'capture').mockImplementation(() => undefined);
        const err = new SidecarHttpError('/start', 502, 'plc fail', false);
        vi.mocked(sidecar.startRoast).mockRejectedValueOnce(err);
        const h = renderActions();
        await act(async () => {
            h.result.triggerCharge(200);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(captureSpy).toHaveBeenCalledWith(err, { context: 'roast start' });
        captureSpy.mockRestore();
    });
});

describe('startCharge 심층 방어 가드 (#174)', () => {
    beforeEach(resetStore);

    it('charged 상태에서 재호출해도 sessionId 재생성 안 함', () => {
        useRoastingStore.getState().startCharge();
        const first = useRoastingStore.getState().sessionId;
        useRoastingStore.getState().startCharge();
        expect(useRoastingStore.getState().sessionId).toBe(first);
    });

    it('ended 상태에서는 Charge 로그와 session을 만들지 않는다', () => {
        useRoastingStore.setState({ phase: 'ended', sessionId: 's-ended' });
        const h = renderActions();
        void act(() => h.result.triggerCharge(200));
        expect(h.setLogEntries).not.toHaveBeenCalled();
        expect(useRoastingStore.getState().sessionId).toBe('s-ended');
        expect(useRoastingStore.getState().phase).toBe('ended');
    });
});

describe('handleAutoDrop', () => {
    beforeEach(resetStore);

    it('uses the shared Drop transition, not an End-confirm dialog', () => {
        const h = renderActions();
        void act(() => h.result.handleAutoDrop({ timeSec: 430, bt: 200 }));
        expect(h.onDrop).toHaveBeenCalledTimes(1);
        expect(h.onDrop).toHaveBeenCalledWith({ timeSec: 430, bt: 200 });
        expect(h.setLogEntries).not.toHaveBeenCalled();
    });
});
