// @vitest-environment jsdom
import { sidecar } from '@shared/lib/sidecar';
import type { Charge, CurveSnapshot, FrozenReference, SidecarStatus } from '@shared/types/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FsdControlPanel } from '../ui/FsdControlPanel';
import { type FsdControlInput, useFsdControl } from './useFsdControl';

const renderHook = (
    hook: (props: ReturnType<typeof defaults>) => ReturnType<typeof useFsdControl>,
    options = { initialProps: defaults() },
) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let current: ReturnType<typeof useFsdControl>;
    const Harness = ({ value }: { value: ReturnType<typeof defaults> }) => {
        current = hook(value);
        return null;
    };
    const rerender = (value: ReturnType<typeof defaults>) => {
        act(() => root.render(createElement(Harness, { value })));
    };
    rerender(options.initialProps);
    return {
        result: {
            get current() {
                return current;
            },
        },
        rerender,
        unmount: () => act(() => root.unmount()),
    };
};

vi.mock('@shared/i18n', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@shared/lib/sidecar', () => ({ sidecar: { pidOn: vi.fn(), pidOff: vi.fn(), pidRenew: vi.fn() } }));
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: () => ({ show: vi.fn() }) } }));
const machine = { machine_id: 'virtual', roaster_key: 'virtual', protocol: 'virtual' };
const charge: Charge = {
    session_id: 'session',
    charge_id: 'charge',
    machine,
    sensor_clock: 'clock',
    connection_epoch: 1,
    acquired_at: 0,
    anchor: null,
    origin_kind: 'now',
    accepted_at: 0,
    state: 'open',
    closed_reason: null,
};
const reference: FrozenReference = {
    version: 'raw-bt-reference-v1',
    source: 'recorded_session',
    source_session_id: 'source',
    source_machine: machine,
    temperature_unit: 'C',
    control_filter_version: 'raw-bt-dt-ema-v1',
    charge: { event_id: 'charge', elapsed_sec: 0 },
    drop: { event_id: 'drop', elapsed_sec: 100 },
    points: [],
};
const curve: CurveSnapshot = {
    mode: 'curve',
    authority: {
        session_id: 'session',
        charge_id: 'charge',
        run_id: 'run',
        sensor_clock: 'clock',
        connection_epoch: 1,
        generation: 1,
    },
    request_id: 'request',
    phase: 'active',
    runner_state: 'running',
    reason: null,
    terminal_outcome: 'none',
    config_id: 'virtual-v1',
    reference_digest: 'digest',
    source_session_id: 'source',
    control_filter_version: 'raw-bt-dt-ema-v1',
    elapsed_sec: 60,
    target_bt_c: 150,
    control_pv_c: 149,
    error_c: 1,
    sample: null,
    sample_age_sec: 0,
    warmup_remaining_sec: 0,
    live_tp: null,
    reference_tp: { minimum_elapsed_sec: 30, confirmed_elapsed_sec: 40, minimum_bt_c: 90 },
    reference_drop_sec: 100,
    target_end_sec: 100,
    requested_heat_set: 40,
    permitted_heat_set: 40,
    last_applied_heat_set: 40,
    heat_feedback: 39,
    lease_deadline: 64,
    pending_writes: 0,
    uncertain: false,
    receipt_next_sequence: 1,
};
const pid = { state: 'running', sv: 150, duty: 40, pv: 149, p: 0, i: 0, d: 0, error: null } as const;
const status: SidecarStatus = {
    connected: true,
    roaster: 'virtual',
    display_name: 'Virtual',
    brand: 'Virtual',
    capabilities: [],
    uptime: 0,
    error: null,
    server_time: 60,
    sensor_clock: 'clock',
    connection_epoch: 1,
    charge,
    heater_control: { connection_epoch: 1, generation: 0, origin: 'manual', pending_writes: 0, uncertain: false },
    control: {
        writable: true,
        limits: { heater: { max: 100, unit: '%' } },
        pid: {
            supported: true,
            sv_min: 50,
            sv_max: 250,
            curve: { supported: true, reason: 'ready', config_id: 'virtual-v1' },
        },
    },
    curve_eligibility: { eligible: true, reason: 'ready', warmup_remaining_sec: 0, live_tp: null },
};
const input: FsdControlInput = {
    reference,
    referenceReason: null,
    referenceLoading: false,
    acceptedCharge: charge,
    sessionId: 'session',
    workspaceId: 'workspace',
    visible: true,
    entitled: true,
};
const defaults = () => ({
    input,
    status,
    healthy: true,
    fixedActive: false,
    replayActive: false,
    roastFinished: false,
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.mocked(sidecar.pidOn).mockResolvedValue({ ok: true, pid, curve, server_time: 61 });
    vi.mocked(sidecar.pidRenew).mockResolvedValue({
        ok: true,
        authority: curve.authority,
        server_time: 62,
        lease_deadline: 66,
    });
    vi.mocked(sidecar.pidOff).mockResolvedValue({
        ok: true,
        pid: { ...pid, state: 'off' },
        curve: { ...curve, phase: 'terminal', runner_state: 'off', terminal_outcome: 'completed', reason: 'user' },
        server_time: 63,
    });
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('FSD view authority', () => {
    it('renews only explicit starts and never adopts a run on remount', async () => {
        const first = renderHook(() => useFsdControl(defaults()));
        await act(async () => {
            await first.result.current.start();
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2100);
        });
        expect(sidecar.pidRenew).toHaveBeenCalledTimes(2);
        first.unmount();
        await act(async () => {});
        expect(sidecar.pidOff).toHaveBeenCalledWith({
            mode: 'curve',
            authority: curve.authority,
            reason: 'view_hidden',
        });
        vi.mocked(sidecar.pidRenew).mockClear();
        const second = renderHook(() => useFsdControl({ ...defaults(), status: { ...status, curve } }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(sidecar.pidRenew).not.toHaveBeenCalled();
        second.unmount();
    });
    it.each(['hidden', 'unhealthy', 'workspace', 'reference', 'drop'] as const)(
        'revokes and halts renewal on %s',
        async (cause) => {
            const hook = renderHook((props) => useFsdControl(props), { initialProps: defaults() });
            await act(async () => {
                await hook.result.current.start();
            });
            const next = defaults();
            if (cause === 'hidden') next.input = { ...input, visible: false };
            if (cause === 'unhealthy') next.healthy = false;
            if (cause === 'workspace') next.input = { ...input, workspaceId: 'other' };
            if (cause === 'reference')
                next.input = { ...input, reference: { ...reference, source_session_id: 'other' } };
            if (cause === 'drop') next.roastFinished = true;
            await act(async () => {
                hook.rerender(next);
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(3000);
            });
            expect(sidecar.pidOff).toHaveBeenCalled();
            expect(sidecar.pidRenew).not.toHaveBeenCalled();
            hook.unmount();
        },
    );
    it('keeps Gas locked and exposes an unconfirmed stop', async () => {
        vi.mocked(sidecar.pidOff).mockResolvedValue({
            ok: true,
            pid,
            curve: { ...curve, phase: 'stopping', terminal_outcome: 'uncertain' },
            server_time: 63,
        });
        const hook = renderHook(() => useFsdControl(defaults()));
        await act(async () => {
            await hook.result.current.start();
        });
        await act(async () => {
            expect(await hook.result.current.stop()).toBe(false);
        });
        expect(hook.result.current.active).toBe(true);
        expect(hook.result.current.failure).toBe('stop_unconfirmed');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(sidecar.pidRenew).not.toHaveBeenCalled();
        hook.unmount();
    });
    it('blocks fixed PID, Replay, mismatched sources, and non-accepted Charge', async () => {
        for (const props of [
            { ...defaults(), fixedActive: true },
            { ...defaults(), replayActive: true },
            { ...defaults(), input: { ...input, acceptedCharge: null } },
            {
                ...defaults(),
                input: { ...input, reference: { ...reference, source_machine: { ...machine, machine_id: 'other' } } },
            },
        ]) {
            const hook = renderHook(() => useFsdControl(props));
            await act(async () => {
                await hook.result.current.start();
            });
            expect(hook.result.current.reason).toBeTruthy();
            hook.unmount();
        }
        expect(sidecar.pidOn).not.toHaveBeenCalled();
    });
    it('formats absolute target/PV and temperature differences separately, keeping Gas units', () => {
        const fsd = {
            curve,
            active: true,
            busy: false,
            failure: null,
            failureDetail: null,
            reason: null,
            start: vi.fn(),
            stop: vi.fn(async () => true),
            available: true,
            receiptStatus: undefined,
        };
        const fahrenheit = renderToStaticMarkup(
            createElement(FsdControlPanel, { fsd, unit: 'F', heaterUnit: 'Pa', commandsLocked: false }),
        );
        expect(fahrenheit).toContain('302.0°F');
        expect(fahrenheit).toContain('300.2°F');
        expect(fahrenheit).toContain('1.8°F');
        expect(fahrenheit).toContain('40.0 Pa');
        const celsius = renderToStaticMarkup(
            createElement(FsdControlPanel, { fsd, unit: 'C', heaterUnit: '%', commandsLocked: false }),
        );
        expect(celsius).toContain('150.0°C');
        expect(celsius).toContain('1.0°C');
    });

    it('stops a start response arriving after the view was hidden', async () => {
        let resolveStart:
            | ((value: { ok: true; pid: typeof pid; curve: CurveSnapshot; server_time: number }) => void)
            | undefined;
        vi.mocked(sidecar.pidOn).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveStart = resolve;
                }),
        );
        const hook = renderHook((props) => useFsdControl(props), { initialProps: defaults() });
        let started: Promise<void>;
        act(() => {
            started = hook.result.current.start();
        });
        await act(async () => {
            hook.rerender({ ...defaults(), input: { ...input, visible: false } });
        });
        await act(async () => {
            resolveStart?.({ ok: true, pid, curve, server_time: 61 });
            await started;
        });
        expect(sidecar.pidOff).toHaveBeenCalledWith({
            mode: 'curve',
            authority: curve.authority,
            reason: 'view_hidden',
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(sidecar.pidRenew).not.toHaveBeenCalled();
        hook.unmount();
    });
    it('waits for reference TP on the server Charge clock', async () => {
        const hook = renderHook(() => useFsdControl({ ...defaults(), input: { ...input, referenceTpTime: 65 } }));
        expect(hook.result.current.reason).toBe('reference_tp_pending');
        await act(async () => {
            await hook.result.current.start();
        });
        expect(sidecar.pidOn).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('stops on document hide and never resumes on document show', async () => {
        const hook = renderHook(() => useFsdControl(defaults()));
        await act(async () => {
            await hook.result.current.start();
        });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(sidecar.pidOff).toHaveBeenCalled();
        expect(sidecar.pidRenew).not.toHaveBeenCalled();
        hook.unmount();
    });
    it('accepts a new boot clock with lower monotonic time without retaining old authority', async () => {
        const hook = renderHook((props) => useFsdControl(props), { initialProps: defaults() });
        await act(async () => {
            await hook.result.current.start();
        });
        vi.mocked(sidecar.pidOff).mockRejectedValue(new Error('retired clock'));
        await act(async () => {
            hook.rerender({
                ...defaults(),
                status: { ...status, server_time: 1, sensor_clock: 'new-clock', curve: null },
            });
        });
        expect(hook.result.current.curve).toBeNull();
        expect(hook.result.current.failure).toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(sidecar.pidRenew).not.toHaveBeenCalled();
        hook.unmount();
    });
});

const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (v: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
};
const reply = (c: CurveSnapshot, time: number) => ({ ok: true as const, pid, curve: c, server_time: time });
const terminal = {
    ...curve,
    phase: 'terminal' as const,
    runner_state: 'off' as const,
    terminal_outcome: 'completed' as const,
    reason: 'user' as const,
};
const second = {
    ...curve,
    authority: { ...curve.authority, run_id: 'second', generation: 3 },
    request_id: 'second-request',
};

describe('independent control lifetime', () => {
    it('stops newly admitted pending start even while an old-run stop is outstanding', async () => {
        const initial = { ...defaults(), status: { ...status, curve: terminal } };
        const hook = renderHook((p) => useFsdControl(p), { initialProps: initial });
        const begin = deferred<ReturnType<typeof reply>>();
        const endOld = deferred<ReturnType<typeof reply>>();
        vi.mocked(sidecar.pidOn).mockReturnValue(begin.promise);
        vi.mocked(sidecar.pidOff)
            .mockReturnValueOnce(endOld.promise)
            .mockResolvedValue(reply({ ...second, ...terminal, authority: second.authority }, 65));
        let starting!: Promise<void>;
        act(() => {
            starting = hook.result.current.start();
        });
        await act(async () => {
            hook.rerender({ ...initial, input: { ...input, visible: false } });
        });
        await act(async () => {
            begin.resolve(reply(second, 62));
            await Promise.resolve();
        });
        await act(async () => {
            endOld.resolve(reply(terminal, 63));
            await starting;
        });
        expect(sidecar.pidOff).toHaveBeenCalledWith({
            mode: 'curve',
            authority: second.authority,
            reason: 'view_hidden',
        });
        hook.unmount();
    });
    it('does not replace newer same-clock server status with a delayed stop reply', async () => {
        const hook = renderHook((p) => useFsdControl(p), { initialProps: defaults() });
        await act(async () => {
            await hook.result.current.start();
        });
        const end = deferred<ReturnType<typeof reply>>();
        vi.mocked(sidecar.pidOff).mockReturnValueOnce(end.promise);
        let stopping!: Promise<boolean>;
        act(() => {
            stopping = hook.result.current.stop();
        });
        await act(async () => {
            hook.rerender({ ...defaults(), status: { ...status, curve: second, server_time: 70 } });
        });
        expect(hook.result.current.curve?.authority.run_id).toBe('second');
        await act(async () => {
            end.resolve(reply(terminal, 63));
            await stopping;
        });
        expect(hook.result.current.curve?.authority.run_id).toBe('second');
        expect(hook.result.current.active).toBe(true);
        hook.unmount();
    });
    it('does not let an old renewal failure revoke a later explicit run', async () => {
        const hook = renderHook((p) => useFsdControl(p), { initialProps: defaults() });
        await act(async () => {
            await hook.result.current.start();
        });
        const renew = deferred<Awaited<ReturnType<typeof sidecar.pidRenew>>>();
        vi.mocked(sidecar.pidRenew).mockReturnValueOnce(renew.promise);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        await act(async () => {
            await hook.result.current.stop();
        });
        vi.mocked(sidecar.pidOn).mockResolvedValue(reply(second, 64));
        await act(async () => {
            await hook.result.current.start();
        });
        vi.mocked(sidecar.pidOff).mockClear();
        await act(async () => {
            renew.reject(new Error('old request failed'));
            await Promise.resolve();
        });
        expect(sidecar.pidOff).not.toHaveBeenCalled();
        hook.unmount();
    });
});

describe('independent closing stop lifetime', () => {
    it('forwards bound Drop even when a user stop of the same run remains pending', async () => {
        const hook = renderHook((p) => useFsdControl(p), { initialProps: defaults() });
        await act(async () => {
            await hook.result.current.start();
        });
        const end = deferred<ReturnType<typeof reply>>();
        vi.mocked(sidecar.pidOff).mockReturnValueOnce(end.promise);
        let stopping!: Promise<boolean>;
        act(() => {
            stopping = hook.result.current.stop('user');
        });
        await act(async () => {
            hook.rerender({ ...defaults(), roastFinished: true });
        });
        await act(async () => {
            end.resolve(reply(terminal, 63));
            await stopping;
        });
        expect(sidecar.pidOff).toHaveBeenCalledWith({ mode: 'curve', authority: curve.authority, reason: 'drop' });
        hook.unmount();
    });
    it('keeps failed stop visible when multiple departure signals target the same run', async () => {
        const hook = renderHook((p) => useFsdControl(p), { initialProps: defaults() });
        await act(async () => {
            await hook.result.current.start();
        });
        const end = deferred<ReturnType<typeof reply>>();
        vi.mocked(sidecar.pidOff).mockReturnValueOnce(end.promise);
        await act(async () => {
            hook.rerender({ ...defaults(), input: { ...input, workspaceId: 'other', visible: false } });
        });
        await act(async () => {
            end.reject(new Error('stop transport failed'));
            await Promise.resolve();
        });
        expect(hook.result.current.failure).toBe('stop_failed');
        hook.unmount();
    });
});

describe('independent renewal ownership', () => {
    it('renews a new explicit run while an older run renewal request remains unresolved', async () => {
        const hook = renderHook((p) => useFsdControl(p), { initialProps: defaults() });
        await act(async () => {
            await hook.result.current.start();
        });
        const renew = deferred<Awaited<ReturnType<typeof sidecar.pidRenew>>>();
        vi.mocked(sidecar.pidRenew).mockReturnValueOnce(renew.promise);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        await act(async () => {
            await hook.result.current.stop();
        });
        vi.mocked(sidecar.pidOn).mockResolvedValue(reply(second, 64));
        await act(async () => {
            await hook.result.current.start();
        });
        vi.mocked(sidecar.pidRenew).mockClear();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2100);
        });
        expect(sidecar.pidRenew).toHaveBeenCalledWith(second.authority);
        renew.resolve({ ok: true, authority: curve.authority, server_time: 62, lease_deadline: 65 });
        hook.unmount();
    });
    it('retains explicit local authority when newer status precedes the start response', async () => {
        const hook = renderHook((p) => useFsdControl(p), { initialProps: defaults() });
        const begin = deferred<ReturnType<typeof reply>>();
        vi.mocked(sidecar.pidOn).mockReturnValueOnce(begin.promise);
        let starting!: Promise<void>;
        act(() => {
            starting = hook.result.current.start();
        });
        await act(async () => {
            hook.rerender({ ...defaults(), status: { ...status, curve, server_time: 62 } });
        });
        await act(async () => {
            begin.resolve(reply(curve, 61));
            await starting;
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1100);
        });
        expect(sidecar.pidRenew).toHaveBeenCalledWith(curve.authority);
        hook.unmount();
    });
});

describe('abandoned start closes the right Charge', () => {
    it.each(['drop', 'workspace_changed'] as const)(
        'retains %s intent while start admission is pending',
        async (reason) => {
            const hook = renderHook((p) => useFsdControl(p), { initialProps: defaults() });
            const begin = deferred<ReturnType<typeof reply>>();
            vi.mocked(sidecar.pidOn).mockReturnValueOnce(begin.promise);
            let starting!: Promise<void>;
            act(() => {
                starting = hook.result.current.start();
            });
            await act(async () => {
                hook.rerender(
                    reason === 'drop'
                        ? { ...defaults(), roastFinished: true }
                        : { ...defaults(), input: { ...input, workspaceId: 'other' } },
                );
            });
            await act(async () => {
                begin.resolve(reply(curve, 61));
                await starting;
            });
            expect(sidecar.pidOff).toHaveBeenCalledWith({ mode: 'curve', authority: curve.authority, reason });
            hook.unmount();
        },
    );
});
