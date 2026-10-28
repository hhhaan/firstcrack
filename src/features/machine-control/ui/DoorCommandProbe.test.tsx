// @vitest-environment jsdom

import type { DoorProbeResult } from '@shared/types/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DoorCommandProbe } from './DoorCommandProbe';

const doorProbe = vi.hoisted(() => vi.fn());
const captureDoorProbe = vi.hoisted(() => vi.fn());
const captureDoorProbeFailure = vi.hoisted(() => vi.fn());

vi.mock('@shared/lib/sidecar', () => ({
    isSidecarHttpError: (error: unknown) => error instanceof Error && error.name === 'SidecarHttpError',
    sidecar: { doorProbe },
}));

vi.mock('@shared/lib/sentry', () => ({
    captureDoorProbe,
    captureDoorProbeFailure,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = (overrides: Partial<DoorProbeResult> = {}): DoorProbeResult => ({
    action: 'discharge_open',
    wrote: 5,
    command_before: 0,
    command_after: 5,
    command_held: true,
    discharge_open_before: false,
    discharge_open_after: false,
    ...overrides,
});

const renderProbe = (roaster: string | null) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
        root.render(createElement(DoorCommandProbe, { roaster, disabled: false }));
    });
    return host;
};

describe('DoorCommandProbe', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        doorProbe.mockReset();
        captureDoorProbe.mockReset();
        captureDoorProbeFailure.mockReset();
    });

    it('stays off other roasters', () => {
        const host = renderProbe('giesen_w6a');
        expect(host.textContent).toBe('');
    });

    it('shows the same test buttons on the virtual machine', () => {
        const host = renderProbe('virtual');
        expect(host.querySelectorAll('button')).toHaveLength(5);
        expect(host.textContent).toContain('machines.doorProbe.dischargeOpen');
    });

    it('shows test buttons that are not tied to Charge or Drop', () => {
        const host = renderProbe('giesen_w45a_w60a');
        const labels = [...host.querySelectorAll('button')].map((button) => button.textContent);
        expect(labels).toEqual([
            'machines.doorProbe.read',
            'machines.doorProbe.fillOpen',
            'machines.doorProbe.fillClose',
            'machines.doorProbe.dischargeOpen',
            'machines.doorProbe.dischargeClose',
        ]);
        expect(host.textContent).toContain('machines.doorProbe.chargeNotLinked');
    });

    it('shows the command cell and status bit without calling that door motion', async () => {
        doorProbe.mockResolvedValue(report());
        const host = renderProbe('giesen_w45a_w60a');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.dischargeOpen',
        );
        await act(async () => {
            button?.click();
        });
        expect(doorProbe).toHaveBeenCalledWith('discharge_open');
        expect(captureDoorProbe).toHaveBeenCalledWith(report());
        expect(host.textContent).toContain('"before":0');
        expect(host.textContent).toContain('"after":5');
        expect(host.textContent).toContain('machines.doorProbe.wroteHeld');
        expect(host.textContent).toContain('machines.doorProbe.notPosition');
        expect(host.textContent).not.toContain('moved');
    });

    it('says when the written value does not stay', async () => {
        doorProbe.mockResolvedValue(report({ command_after: 0, command_held: false }));
        const host = renderProbe('giesen_w45a_w60a');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.dischargeOpen',
        );
        await act(async () => {
            button?.click();
        });
        expect(host.textContent).toContain('machines.doorProbe.wroteLost');
        expect(host.textContent).toContain('"after":0');
        expect(captureDoorProbe).toHaveBeenCalledWith(
            expect.objectContaining({ command_held: false, command_after: 0 }),
        );
    });

    it('reports a failed probe with the button that was pressed', async () => {
        const failure = new Error('문 명령 확인에 실패했습니다.');
        failure.name = 'SidecarHttpError';
        doorProbe.mockRejectedValue(failure);
        const host = renderProbe('giesen_w45a_w60a');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.fillOpen',
        );
        await act(async () => {
            button?.click();
        });
        expect(captureDoorProbeFailure).toHaveBeenCalledWith('fill_open', '문 명령 확인에 실패했습니다.');
        expect(captureDoorProbe).not.toHaveBeenCalled();
    });
});
