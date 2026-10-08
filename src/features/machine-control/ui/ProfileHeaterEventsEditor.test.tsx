// @vitest-environment jsdom
import { sidecar } from '@shared/lib/sidecar';
import type { SidecarStatus } from '@shared/types/sidecar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sidecarStatusKey } from '../api/useSidecarStatus';
import type { ReplayEvent } from '../lib/replay';
import { ProfileHeaterEventsEditor } from './ProfileHeaterEventsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key),
    }),
}));
vi.mock('@shared/lib/sidecar', () => ({ sidecar: { getStatus: vi.fn() } }));

const STATUS: SidecarStatus = {
    connected: true,
    roaster: 'giesen_wxa_coarse',
    display_name: 'Giesen WxA coarse',
    brand: 'Giesen',
    capabilities: ['heater'],
    control: { writable: true, limits: { heater: { min: 1, max: 10, unit: 'step' } } },
    uptime: 1,
    error: null,
};

describe('ProfileHeaterEventsEditor status query', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let qc: QueryClient;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        vi.mocked(sidecar.getStatus).mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        qc.clear();
    });

    const waitForEditor = async () => {
        for (let i = 0; i < 20 && !document.querySelector('[data-testid="heater-events-editor"]'); i++) {
            await act(async () => {
                await new Promise((r) => setTimeout(r, 10));
            });
        }
        return document.querySelector('[data-testid="heater-events-editor"]');
    };

    const saveHeater = async (value: string) => {
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
    };

    const renderEditor = async (onApply: (events: ReplayEvent[] | null) => void | Promise<void>) => {
        await act(async () => {
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: qc },
                    createElement(ProfileHeaterEventsEditor, {
                        profile: { machine_roaster_key: 'giesen_wxa_coarse' },
                        events: [{ t: 0, bt: 180, heater: 8, trigger: 'time' as const }],
                        tpTime: 60,
                        btPoints: [],
                        source: 'profile',
                        unit: 'C',
                        onClose: () => {},
                        onApply,
                    }),
                ),
            );
        });
    };

    it('holds the editor until matching status arrives, then rejects 50 against max 10', async () => {
        let resolveStatus!: (status: SidecarStatus) => void;
        vi.mocked(sidecar.getStatus).mockImplementation(
            () =>
                new Promise<SidecarStatus>((resolve) => {
                    resolveStatus = resolve;
                }),
        );
        const onApply = vi.fn();
        await renderEditor(onApply);
        expect(document.querySelector('[data-testid="heater-events-editor"]')).toBeNull();
        expect(onApply).not.toHaveBeenCalled();

        await act(async () => {
            resolveStatus(STATUS);
            await Promise.resolve();
        });
        expect(await waitForEditor()).not.toBeNull();
        await saveHeater('50');
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            'heaterEventsEditor.heatRange|{"row":1,"min":1,"max":10,"unit":"step"}',
        );
        expect(qc.getQueryState(sidecarStatusKey)?.status).toBe('success');
    });

    it('does not use cached max 100 while a fresh max 10 fetch is in flight', async () => {
        qc.setQueryData(sidecarStatusKey, {
            ...STATUS,
            control: { writable: true, limits: { heater: { min: 1, max: 100, unit: '%' } } },
        });
        let resolveStatus!: (status: SidecarStatus) => void;
        vi.mocked(sidecar.getStatus).mockImplementation(
            () =>
                new Promise<SidecarStatus>((resolve) => {
                    resolveStatus = resolve;
                }),
        );
        const onApply = vi.fn();
        await renderEditor(onApply);
        expect(document.querySelector('[data-testid="heater-events-editor"]')).toBeNull();
        expect(onApply).not.toHaveBeenCalled();

        await act(async () => {
            resolveStatus(STATUS);
            await Promise.resolve();
        });
        expect(await waitForEditor()).not.toBeNull();
        await saveHeater('50');
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            'heaterEventsEditor.heatRange|{"row":1,"min":1,"max":10,"unit":"step"}',
        );
    });

    it('saves a positive then zero plan when the connected W60A reports min 0', async () => {
        vi.mocked(sidecar.getStatus).mockResolvedValue({
            ...STATUS,
            roaster: 'giesen_w45a_w60a',
            display_name: 'Giesen W45A / W60A',
            control: { writable: true, limits: { heater: { min: 0, max: 100, unit: '%' } } },
        });
        const onApply = vi.fn();
        await act(async () => {
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: qc },
                    createElement(ProfileHeaterEventsEditor, {
                        profile: { machine_roaster_key: 'giesen_w45a_w60a' },
                        events: [{ t: 0, bt: 100, heater: 80, trigger: 'time' as const }],
                        tpTime: 60,
                        btPoints: [],
                        source: 'profile',
                        unit: 'C',
                        onClose: () => {},
                        onApply,
                    }),
                ),
            );
        });
        expect(await waitForEditor()).not.toBeNull();
        await act(async () =>
            [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.addStep')
                ?.click(),
        );
        const heats = document.querySelectorAll<HTMLInputElement>('tbody input[aria-label="heaterEventsEditor.heat"]');
        const off = heats[heats.length - 1];
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(off, '0');
            off.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
        expect(onApply).toHaveBeenCalledOnce();
        expect(onApply.mock.calls[0][0].map((event: { heater: number }) => event.heater)).toEqual([80, 0]);
    });
});
