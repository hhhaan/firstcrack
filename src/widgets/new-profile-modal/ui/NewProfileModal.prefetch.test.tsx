// @vitest-environment jsdom

import { roastCurveKeys } from '@shared/lib/roast-curve';
import { sidecar } from '@shared/lib/sidecar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProfileModal } from './NewProfileModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fromMock = vi.fn();
const fetchTsv = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock('@shared/lib/r2', () => ({
    fetchTsvFromR2: (...args: unknown[]) => fetchTsv(...args),
}));

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: async (_key: string, fallback: unknown) => fallback,
    settingsSet: async () => undefined,
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1' }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const tables: string[] = [];

function mockTables(sessions: unknown[]) {
    fromMock.mockImplementation((table: string) => {
        tables.push(table);
        const data = table === 'roast_sessions' ? sessions : [];
        const terminal = Promise.resolve({ data, error: null });
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        for (const key of ['select', 'eq', 'order', 'gte', 'lt', 'lte']) chain[key] = vi.fn(self);
        chain.range = vi.fn(self);
        Object.assign(chain, {
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for supabase builder
            then: terminal.then.bind(terminal),
            catch: terminal.catch.bind(terminal),
        });
        return chain;
    });
}

describe('NewProfileModal closed prefetch', () => {
    let qc: QueryClient;
    let host: HTMLDivElement;
    let root: Root;

    const flush = async () => {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
        });
    };

    const renderModal = async (props: {
        open: boolean;
        initialSessionId?: string | null;
        editing?: boolean;
        profileId?: string;
        profileName?: string;
        profileHeat?: unknown;
        sourceHeat?: unknown;
    }) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <NewProfileModal
                        open={props.open}
                        initialSessionId={props.initialSessionId}
                        editingProfile={
                            props.editing
                                ? ({
                                      id: props.profileId ?? 'p1',
                                      name: props.profileName ?? 'Edit me',
                                      source_session_id: 's1',
                                      source_session: {
                                          tsv_path: 'curves/s1.tsv',
                                          events: null,
                                          heater_events: props.sourceHeat ?? null,
                                      },
                                      heater_events: props.profileHeat ?? null,
                                      default_bean_id: null,
                                      default_blend_id: null,
                                      description: '',
                                      target_level: 'Medium',
                                  } as never)
                                : null
                        }
                        onClose={() => {}}
                        onCreated={() => {}}
                    />
                </QueryClientProvider>,
            );
        });
        await flush();
    };

    beforeEach(() => {
        tables.length = 0;
        fromMock.mockReset();
        fetchTsv.mockReset();
        mockTables([
            {
                id: 's1',
                beans: { name: 'Ethiopia' },
                roasted_at: '2026-09-01T00:00:00Z',
                events: null,
                roast_level: 'Medium',
                drop_temp_celsius: 200,
                duration_seconds: 600,
            },
        ]);
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        qc.clear();
        vi.restoreAllMocks();
    });

    it('opens the roast record TSV heat when that record has no saved plan', async () => {
        vi.spyOn(sidecar, 'getStatus').mockResolvedValue({
            connected: false,
            control: { writable: false, limits: {} },
        } as never);
        qc.setQueryData(roastCurveKeys.byPath('curves/s1.tsv'), [
            { t: 0, bt: 180, heaterSet: 80 },
            { t: 60, bt: 100, heaterSet: 80 },
        ]);
        await renderModal({ open: true, editing: true, profileHeat: [{ t: 0, bt: 180, heater: 70 }] });
        await act(async () =>
            [...document.querySelectorAll('button')]
                .find((button) => button.textContent === 'heaterEventsEditor.editHeat')
                ?.click(),
        );
        await flush();
        const editor = document.querySelector('[data-testid="heater-events-editor"]');
        const heat = editor?.querySelector<HTMLInputElement>('tbody input[aria-label="heaterEventsEditor.heat"]');
        expect(heat?.value).toBe('80');
        expect(editor?.textContent).toContain('heaterEventsEditor.sourceTsv');
        expect(editor?.textContent).not.toContain('heaterEventsEditor.revert');
    });

    it('opens the roast record heat plan', async () => {
        vi.spyOn(sidecar, 'getStatus').mockResolvedValue({
            connected: false,
            control: { writable: false, limits: {} },
        } as never);
        qc.setQueryData(roastCurveKeys.byPath('curves/s1.tsv'), [
            { t: 0, bt: 180, heaterSet: 80 },
            { t: 60, bt: 100, heaterSet: 80 },
        ]);
        await renderModal({
            open: true,
            editing: true,
            profileHeat: [{ t: 0, bt: 180, heater: 70 }],
            sourceHeat: [{ t: 0, bt: 180, heater: 60 }],
        });
        await act(async () =>
            [...document.querySelectorAll('button')]
                .find((button) => button.textContent === 'heaterEventsEditor.editHeat')
                ?.click(),
        );
        await flush();
        const editor = document.querySelector('[data-testid="heater-events-editor"]');
        const heat = editor?.querySelector<HTMLInputElement>('tbody input[aria-label="heaterEventsEditor.heat"]');
        expect(heat?.value).toBe('60');
        expect(editor?.textContent).toContain('heaterEventsEditor.sourceSession');
        expect(editor?.textContent).toContain('heaterEventsEditor.revert');
    });

    it('does not list sessions, beans, blends, or curves while closed', async () => {
        await renderModal({ open: false, editing: true });

        expect(tables).toEqual([]);
        expect(fetchTsv).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain('newProfileModal');
    });

    it('loads the picker when opened and auto-selects initialSessionId', async () => {
        await renderModal({ open: true, initialSessionId: 's1' });

        expect(tables).toContain('roast_sessions');
        expect(tables).toContain('beans');
        expect(tables).toContain('blends');
        expect(fetchTsv).not.toHaveBeenCalled();

        const name = document.body.querySelector('input');
        expect(name?.value).toBe('Ethiopia 2026-09-01');
    });

    const editName = (value: string) => {
        const input = document.body.querySelector('input');
        if (!input) throw new Error('Profile name input missing');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    it('keeps a draft through same-profile refreshes and resets when the editing target changes', async () => {
        await renderModal({ open: true, editing: true });
        act(() => editName('Unsaved draft'));
        await renderModal({ open: true, editing: true, profileName: 'Server refresh' });
        expect(document.body.querySelector('input')?.value).toBe('Unsaved draft');

        await renderModal({ open: true, editing: true, profileId: 'p2', profileName: 'Other profile' });
        expect(document.body.querySelector('input')?.value).toBe('Other profile');
    });

    it('discards an edit on close and reopens with a clean create picker or saved edit', async () => {
        await renderModal({ open: true, editing: true });
        act(() => editName('Unsaved draft'));
        await renderModal({ open: false, editing: true });
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();

        await renderModal({ open: true });
        expect(document.body.textContent).toContain('newProfileModal.selectSession');
        expect(document.body.querySelector('input')).toBeNull();
        await renderModal({ open: false });
        await renderModal({ open: true, editing: true });
        expect(document.body.querySelector('input')?.value).toBe('Edit me');
    });
});
