// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputWeightEditor } from './OutputWeightEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { setOutput } = vi.hoisted(() => ({
    setOutput: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: { max: number }) => (vars ? `${key}:${vars.max}` : key),
    }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));
vi.mock('@entities/roast', () => ({
    useSetOutputWeight: () => ({ mutateAsync: setOutput, isPending: false }),
}));

const session = {
    id: 's1',
    weight_grams: 0,
    output_weight_grams: null,
    roast_level: null,
} as RoastSessionWithRelations;

describe('OutputWeightEditor', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        setOutput.mockClear();
    });

    const render = async (node: ReturnType<typeof createElement>) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(node);
        });
    };

    const input = () => host.querySelector('[aria-label="history.expanded.outputWeight"]') as HTMLInputElement;

    const blur = async (value: string) => {
        const el = input();
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
            el.focus();
        });
        await act(async () => {
            setValue?.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            el.blur();
        });
    };

    it('treats output 0 as unset when charge is 0', async () => {
        await render(createElement(OutputWeightEditor, { session }));
        await blur('0');
        expect(setOutput).not.toHaveBeenCalled();
        expect(input().value).toBe('');
        expect(host.textContent).not.toContain('outputWeightInvalid');
        expect(host.textContent).not.toContain('outputNeedsCharge');
    });

    it('asks for a charge instead of a 1–0g range', async () => {
        await render(createElement(OutputWeightEditor, { session }));
        await blur('100');
        expect(setOutput).not.toHaveBeenCalled();
        expect(host.textContent).toContain('history.expanded.outputNeedsCharge');
        expect(host.textContent).not.toContain('1–0');
    });

    it('rejects letters in the output weight', async () => {
        await render(createElement(OutputWeightEditor, { session: { ...session, weight_grams: 850 } }));
        await blur('85.5');
        expect(input().value).toBe('');
        await blur('850');
        expect(input().value).toBe('850');
    });

    it('still rejects output above a real charge', async () => {
        await render(createElement(OutputWeightEditor, { session: { ...session, weight_grams: 850 } }));
        await blur('900');
        expect(setOutput).not.toHaveBeenCalled();
        expect(host.textContent).toContain('history.expanded.outputWeightInvalid:850');
    });
});
