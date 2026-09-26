// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMachineControlPanelShown } from '../lib/controlPanelShown';
import { type MachineControlComposition, useMachineControlComposition } from '../model/useMachineControlComposition';
import {
    applyControl,
    baseMachineControlInput as baseInput,
    offPidResponse,
    pidRuntime as runtime,
    writableHeaterStatus,
} from '../model/useMachineControlComposition.fixtures';
import { MachineControlPanel } from './MachineControlPanel';

const flags = vi.hoisted(() => ({ entitled: true }));

vi.mock('@shared/lib/features', () => ({
    FEATURE: { machineControl: 'machineControl' },
    useFeature: () => flags.entitled,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: { getStatus: vi.fn(), setControl: vi.fn(), pidOff: vi.fn() },
}));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: () => ({ show: vi.fn() }) } }));

import { sidecar } from '@shared/lib/sidecar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatus = vi.mocked(sidecar.getStatus);
const setControl = vi.mocked(sidecar.setControl);
const pidOff = vi.mocked(sidecar.pidOff);

const panelModel = (
    over: {
        writable?: boolean;
        pidActive?: boolean;
        pidState?: string;
        pidEngaged?: boolean;
        pidError?: string | null;
        replayActive?: boolean;
        unacknowledged?: Array<'heater' | 'fan' | 'drum'>;
        heaterUnit?: string;
        fan?: boolean;
        changeManual?: (role: 'heater' | 'fan' | 'drum', value: number) => void;
        commitManual?: () => void;
        stop?: () => void;
    } = {},
): MachineControlComposition => {
    const stop = over.stop ?? vi.fn();
    return {
        machine: {
            writable: over.writable ?? true,
            limits: {
                heater: { min: 0, max: 100, unit: over.heaterUnit ?? '%' },
                ...(over.fan ? { fan: { min: 0, max: 100, unit: '%' } } : {}),
            },
            desired: { heater: 40 },
            unacknowledged: new Set(over.unacknowledged ?? []),
            sending: false,
        },
        pid: {
            supported: true,
            state: over.pidState ?? 'off',
            engaged: over.pidEngaged ?? false,
            busy: false,
            sv: 200,
            svMin: 50,
            svMax: 250,
            duty: 40,
            pv: 180,
            error: over.pidError ?? null,
            turnOn: vi.fn(),
            turnOff: vi.fn(),
            previewSv: vi.fn(),
            commitSv: vi.fn(),
        },
        replay: {
            active: over.replayActive ?? false,
            stop,
            toggle: vi.fn(),
            plan: { events: [], tpTime: 60 },
            source: 'batch',
            firedCount: 0,
            applyBatchEvents: vi.fn(),
            available: true,
            blocked: false,
            machineMismatch: false,
            referenceLoading: false,
            missingHeatSet: false,
            observationHold: false,
            nextEvent: null,
            nextEventTrigger: null,
            tpTime: 60,
            confirmedTurningPoint: null,
            stopReason: null,
        },
        pidActive: over.pidActive ?? false,
        changeManual: over.changeManual ?? vi.fn(),
        commitManual: over.commitManual ?? vi.fn(),
    } as unknown as MachineControlComposition;
};

const renderPanel = (model: MachineControlComposition, hotkeysEnabled = false) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(
            createElement(MachineControlPanel, {
                model,
                liveData: { heater: 40, fan: 0, drum: 0 },
                replayPoints: [],
                pidDropBehavior: 'hold',
                temperatureUnit: 'C',
                hotkeysEnabled,
            }),
        );
    });
    return {
        host,
        unmount: () => {
            act(() => root.unmount());
            host.remove();
        },
    };
};

const press = (el: Element) => {
    act(() => {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
};

describe('isMachineControlPanelShown', () => {
    it('keeps an active PID on screen when the plan or the link would hide the sliders', () => {
        expect(
            isMachineControlPanelShown({ pidActive: true, entitled: false, writable: false, hasChannel: false }),
        ).toBe(true);
        expect(isMachineControlPanelShown({ pidActive: false, entitled: true, writable: true, hasChannel: true })).toBe(
            true,
        );
        expect(
            isMachineControlPanelShown({ pidActive: false, entitled: false, writable: true, hasChannel: true }),
        ).toBe(false);
        expect(
            isMachineControlPanelShown({ pidActive: false, entitled: true, writable: false, hasChannel: true }),
        ).toBe(false);
    });
});

describe('MachineControlPanel display', () => {
    beforeEach(() => {
        flags.entitled = true;
    });

    it('toggles the visible panel with T only while roast shortcuts are enabled', () => {
        const pressT = () => {
            act(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
            });
        };
        const disabled = renderPanel(panelModel());
        pressT();
        expect(disabled.host.querySelector('[aria-hidden="false"]')).not.toBeNull();
        disabled.unmount();

        const enabled = renderPanel(panelModel(), true);
        expect(enabled.host.querySelector('[aria-keyshortcuts="t"]')).not.toBeNull();
        pressT();
        expect(enabled.host.querySelector('[aria-hidden="true"]')).not.toBeNull();
        pressT();
        expect(enabled.host.querySelector('[aria-hidden="false"]')).not.toBeNull();
        enabled.unmount();
    });

    it('hides the panel when the operator cannot write and PID is off', () => {
        flags.entitled = false;
        const { host, unmount } = renderPanel(panelModel({ writable: true, pidActive: false }));
        expect(host.textContent).toBe('');
        unmount();
    });

    it('shows a PID fault when the plan is not entitled, and keeps it after folding', () => {
        flags.entitled = false;
        const changeManual = vi.fn();
        const { host, unmount } = renderPanel(
            panelModel({
                writable: false,
                pidActive: true,
                pidState: 'fault',
                pidError: 'BT sensor lost',
                changeManual,
            }),
        );
        expect(host.textContent).toContain('BT sensor lost');
        expect(host.textContent).toContain('Fault');

        const plus = host.querySelector('[aria-label="Heater plus 5"]') as HTMLButtonElement;
        expect(plus.disabled).toBe(true);
        press(plus);
        expect(changeManual).not.toHaveBeenCalled();

        act(() => (host.querySelector('[aria-label="Collapse machine control"]') as HTMLButtonElement).click());
        expect(host.querySelector('[aria-label="PID fault"]')).not.toBeNull();
        expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
        expect(host.textContent).toContain('BT sensor lost');

        act(() => (host.querySelector('[aria-label="Expand machine control"]') as HTMLButtonElement).click());
        expect(host.querySelector('[aria-hidden="false"]')).not.toBeNull();
        expect(host.textContent).toContain('BT sensor lost');
        unmount();
    });

    it('sends a manual heater step as change then commit, and folding sends nothing', () => {
        const order: string[] = [];
        const { host, unmount } = renderPanel(
            panelModel({
                changeManual: () => order.push('change'),
                commitManual: () => order.push('commit'),
            }),
        );
        press(host.querySelector('[aria-label="Heater plus 5"]') as HTMLButtonElement);
        expect(order).toEqual(['change', 'commit']);

        act(() => (host.querySelector('[aria-label="Collapse machine control"]') as HTMLButtonElement).click());
        expect(order).toEqual(['change', 'commit']);
        expect(host.querySelector('[aria-label="Heater plus 5"]')).not.toBeNull();
        unmount();
    });

    it('locks the heater slider while Replay is on and still shows that on the folded rail', () => {
        const stop = vi.fn();
        const { host, unmount } = renderPanel(panelModel({ replayActive: true, stop }));
        expect(host.textContent).toContain('Replay');
        const plus = host.querySelector('[aria-label="Heater plus 5"]') as HTMLButtonElement;
        expect(plus.disabled).toBe(true);

        act(() => (host.querySelector('[aria-label="Collapse machine control"]') as HTMLButtonElement).click());
        expect(stop).not.toHaveBeenCalled();
        expect(host.querySelector('[aria-label="Replay 재생 중"]')).not.toBeNull();
        unmount();
    });

    it('shows the unacked-command fault in the open panel and on the folded rail', () => {
        const { host, unmount } = renderPanel(panelModel({ unacknowledged: ['heater'] }));
        expect(host.textContent).toContain('기기가 명령을 반영하지 않았습니다');
        act(() => (host.querySelector('[aria-label="Collapse machine control"]') as HTMLButtonElement).click());
        expect(host.querySelector('[aria-label="기기가 명령을 반영하지 않았습니다"]')).not.toBeNull();
        unmount();
    });

    it('uses the percent scale when the heater is percent, and faders otherwise', () => {
        const percent = renderPanel(panelModel({ fan: true }));
        expect(percent.host.querySelector('[aria-label="Heater plus 5"]')).not.toBeNull();
        expect(percent.host.querySelector('[aria-label="Fan plus"]')).not.toBeNull();
        expect(percent.host.querySelector('[aria-label="Drum setpoint"]')).toBeNull();
        percent.unmount();

        const fader = renderPanel(panelModel({ heaterUnit: 'level', fan: true }));
        expect(fader.host.querySelector('[aria-label="Heater setpoint"]')).not.toBeNull();
        expect(fader.host.querySelector('[aria-label="Fan setpoint"]')).not.toBeNull();
        expect(fader.host.querySelector('[aria-label="Drum not supported"]')).not.toBeNull();
        expect(fader.host.querySelector('[aria-label="Heater plus 5"]')).toBeNull();
        fader.unmount();
    });

    it('opens the batch heat editor without stopping Replay', () => {
        const stop = vi.fn();
        const { host, unmount } = renderPanel(panelModel({ stop }));
        const edit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.editHeat');
        act(() => edit?.click());
        expect(host.querySelector('[data-testid="heater-events-editor"]')).not.toBeNull();
        expect(stop).not.toHaveBeenCalled();
        const cancel = [...host.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.cancel');
        act(() => cancel?.click());
        expect(host.querySelector('[data-testid="heater-events-editor"]')).toBeNull();
        unmount();
    });
});

describe('MachineControlPanel fold keeps the control hook', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        flags.entitled = true;
        getStatus.mockReset();
        setControl.mockReset();
        pidOff.mockReset();
        getStatus.mockResolvedValue(writableHeaterStatus);
        setControl.mockImplementation(applyControl);
        pidOff.mockResolvedValue(offPidResponse);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('collapsing does not stop Replay or skip Drop safe-off', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const modelRef: { current: MachineControlComposition | null } = { current: null };
        let input = baseInput();
        const Harness = () => {
            const model = useMachineControlComposition(input);
            modelRef.current = model;
            return createElement(MachineControlPanel, {
                model,
                liveData: {
                    heater: input.liveData?.heater ?? null,
                    fan: input.liveData?.fan ?? 0,
                    drum: input.liveData?.drum ?? 0,
                },
                replayPoints: input.replayPoints,
                pidDropBehavior: input.pidDropBehavior,
                temperatureUnit: 'C',
            });
        };
        await act(async () => {
            root.render(createElement(Harness));
        });
        await act(async () => {
            modelRef.current?.replay.toggle();
        });
        expect(modelRef.current?.replay.active).toBe(true);

        const before = setControl.mock.calls.length;
        act(() => (host.querySelector('[aria-label="Collapse machine control"]') as HTMLButtonElement).click());
        expect(modelRef.current?.replay.active).toBe(true);
        expect(host.querySelector('[aria-label="activeRoast.replay.tp.collapsedWaiting"]')).not.toBeNull();
        expect(setControl.mock.calls.length).toBe(before);

        input = { ...baseInput(), pidRuntime: runtime('running'), roastFinished: true };
        await act(async () => {
            root.render(createElement(Harness));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledWith('hold');
        expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
        expect(host.textContent).toContain('Running');

        act(() => root.unmount());
        host.remove();
    });
});
