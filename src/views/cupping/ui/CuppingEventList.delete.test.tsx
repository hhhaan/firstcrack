// @vitest-environment jsdom

import type { CuppingEventSummary } from '@entities/cupping';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CuppingEventDetail } from './CuppingEventDetail';
import { CuppingEventList } from './CuppingEventList';
import { DeleteCuppingEventModal } from './DeleteCuppingEventModal';

const mutate = vi.fn();
const mutateAsync = vi.fn();
const reset = vi.fn();

vi.mock('@entities/cupping', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/cupping')>();
    return {
        ...actual,
        useCreateCuppingEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
        useDeleteCuppingEvent: () => ({ mutate, mutateAsync, isPending: false, error: null, reset }),
        useCuppingSamples: () => ({ data: [], isLoading: false }),
        useCuppingEvent: () => ({ data: null }),
        useEndCuppingEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
        useCuppingFormTemplates: () => ({ data: [], isLoading: false }),
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    confirm: vi.fn(async () => {
        throw new Error('plugin-dialog confirm must not be used for cupping delete');
    }),
}));

vi.mock('./CuppingAddSamplesForm', () => ({ CuppingAddSamplesForm: () => null }));
vi.mock('./CuppingResultsShare', () => ({ CuppingResultsShare: () => null }));
vi.mock('./CuppingSampleSummary', () => ({ CuppingSampleSummary: () => null }));
vi.mock('./CuppingSessionInvite', () => ({ CuppingSessionInvite: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const event: CuppingEventSummary = {
    id: 'ev-1',
    user_id: 'user-1',
    title: 'Cupping session',
    held_at: '2026-09-17T00:00:00.000Z',
    notes: null,
    ended_at: null,
    results_token: null,
    form_template_id: null,
    form_snapshot: {
        v: 1,
        key: 'sca_v1',
        name: 'SCA',
        fields: [],
        scoring: { base: 36, defectWeight: 2 },
    },
    created_at: '2026-09-17T00:00:00.000Z',
    updated_at: '2026-09-17T00:00:00.000Z',
    sample_count: 0,
    score_count: 0,
    participant_count: 0,
    participants: [],
    avg_score: null,
    active_invite: null,
};

const hosts: { host: HTMLElement; unmount: () => void }[] = [];

const renderList = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const entry = {
        host,
        unmount: () => {
            act(() => root.unmount());
            host.remove();
        },
    };
    hosts.push(entry);
    act(() =>
        root.render(
            createElement(CuppingEventList, {
                userId: 'user-1',
                events: [event],
                isLoading: false,
                isError: false,
                error: null,
                onRetry: () => {},
                onSelect: () => {},
                onOpenForms: () => {},
            }),
        ),
    );
    return entry;
};

beforeEach(() => {
    mutate.mockReset();
    mutateAsync.mockReset();
    reset.mockReset();
});

afterEach(() => {
    for (const entry of hosts) entry.unmount();
    hosts.length = 0;
});

it('opens an in-app confirm dialog from the list trash control', () => {
    const { host } = renderList();
    const trash = host.querySelector('button[aria-label="cupping.deleteEvent"]') as HTMLButtonElement;
    expect(trash).toBeTruthy();

    act(() => {
        trash.click();
    });

    const dialog = host.querySelector('[data-testid="cupping-delete-event-modal"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('cupping.deleteEventConfirm');
    expect(mutate).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
});

it('shows a delete failure in the confirm dialog', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(DeleteCuppingEventModal, {
                open: true,
                sessionTitle: 'Cupping session',
                error: 'cupping.deleteEventFailed',
                onClose: () => {},
                onConfirm: () => {},
            }),
        ),
    );
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('cupping.deleteEventFailed');
    act(() => root.unmount());
    host.remove();
});

it('deletes the session when the in-app confirm is accepted', () => {
    const { host } = renderList();
    const trash = host.querySelector('button[aria-label="cupping.deleteEvent"]') as HTMLButtonElement;

    act(() => {
        trash.click();
    });

    const confirmBtn = host.querySelector('[data-testid="cupping-delete-confirm"]') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();

    act(() => {
        confirmBtn.click();
    });

    expect(mutate).toHaveBeenCalledWith('ev-1', expect.objectContaining({ onSuccess: expect.any(Function) }));
});

it('calls onDeleted only after a successful detail delete', () => {
    const onDeleted = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(CuppingEventDetail, {
                eventId: 'ev-1',
                event,
                userId: 'user-1',
                onBack: () => {},
                onDeleted,
            }),
        ),
    );

    const deleteBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'cupping.deleteEvent');
    expect(deleteBtn).toBeTruthy();
    act(() => {
        deleteBtn?.click();
    });

    const confirmBtn = host.querySelector('[data-testid="cupping-delete-confirm"]') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    act(() => {
        confirmBtn.click();
    });

    expect(mutate).toHaveBeenCalledWith('ev-1', expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(onDeleted).not.toHaveBeenCalled();

    const opts = mutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => {
        opts.onSuccess();
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    host.remove();
});
