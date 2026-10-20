// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { assert, expect, it, vi } from 'vitest';
import { CuppingAddSamplesForm } from './CuppingAddSamplesForm';

const mocks = vi.hoisted(() => ({ add: vi.fn(async () => {}), update: vi.fn(async () => {}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@entities/cupping', () => ({
    formatBeanCuppingMeta: () => '',
    useAddCuppingSamples: () => ({ mutateAsync: mocks.add, isPending: false }),
    useUpdateCuppingSample: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('@entities/roast', () => ({
    useRoastSessions: () => ({
        data: ['A', 'B'].map((name) => ({
            id: name,
            batch_name: `Batch ${name}`,
            beans: { name: 'Green B' },
            roasted_at: '2026-10-19T00:00:00Z',
            roast_level: 'Medium',
            roast_profiles: { name: 'Profile A' },
        })),
    }),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('distinguishes same-day batches and attaches the chosen session while preserving sample labels', async () => {
    const root = createRoot(document.createElement('div'));
    try {
        act(() =>
            root.render(createElement(CuppingAddSamplesForm, { userId: 'owner', eventId: 'event', onClose: vi.fn() })),
        );
        const choices = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        expect(choices).toHaveLength(2);
        expect(choices[0].closest('label')?.textContent).toContain('Batch A');
        expect(choices[1].closest('label')?.textContent).toContain('Batch B');
        act(() => choices[1].click());
        const add = [...document.querySelectorAll('button')].find((button) => button.textContent === 'cupping.add');
        assert(add);
        await act(async () => add.click());
        expect(mocks.add).toHaveBeenCalledExactlyOnceWith([{ label: 'Green B', roastSessionId: 'B' }]);
    } finally {
        act(() => root.unmount());
    }
});
