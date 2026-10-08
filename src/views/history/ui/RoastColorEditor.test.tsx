// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoastColorEditor } from './RoastColorEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { update } = vi.hoisted(() => ({ update: vi.fn(async () => ({ id: 's1' })) }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));
vi.mock('@entities/roast', () => ({
    useUpdateRoastSession: () => ({ mutateAsync: update, isPending: false }),
}));

const session = {
    id: 's1',
    color_whole: '58.4',
    color_ground: null,
} as RoastSessionWithRelations;

describe('RoastColorEditor', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        update.mockClear();
    });

    const render = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(createElement(RoastColorEditor, { session }));
        });
    };

    const field = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;

    const type = async (input: HTMLInputElement, value: string) => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
            setValue?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };

    it('writes the edited column when the field blurs', async () => {
        await render();
        const input = field('history-color-whole');
        await act(async () => {
            input.focus();
        });
        await type(input, '58.4, 58.7, 59.0');
        await act(async () => {
            input.blur();
        });
        expect(update).toHaveBeenCalledWith({ id: 's1', color_whole: '58.4, 58.7, 59.0' });
    });

    it('clears a color when the field is emptied', async () => {
        await render();
        const input = field('history-color-whole');
        await act(async () => {
            input.focus();
        });
        await type(input, '');
        await act(async () => {
            input.blur();
        });
        expect(update).toHaveBeenCalledWith({ id: 's1', color_whole: null });
    });

    it('preserves non-numeric free text', async () => {
        await render();
        const input = field('history-color-ground');
        await act(async () => {
            input.focus();
        });
        await type(input, 'WB 58.4 (avg)');
        await act(async () => {
            input.blur();
        });
        expect(update).toHaveBeenCalledWith({ id: 's1', color_ground: 'WB 58.4 (avg)' });
    });
});
