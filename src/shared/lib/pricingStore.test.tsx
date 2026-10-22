// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./settings-store', () => ({ settingsGet: storage.get, settingsSet: storage.set }));
vi.mock('./logger', () => ({ logger: { capture: vi.fn() } }));

const key = 'pricing.fixedOverheads';
const old = [{ id: 'rent', name: 'Rent', amountPerKg: 1000 }];
const edited = [{ id: 'rent', name: 'Rent', amountPerKg: 2000 }];

describe('fixed overhead preference', () => {
    let root: Root | undefined;
    let host: HTMLDivElement | undefined;

    beforeEach(() => {
        vi.resetModules();
        vi.resetAllMocks();
        localStorage.clear();
        storage.set.mockResolvedValue(undefined);
    });
    afterEach(() => {
        act(() => root?.unmount());
        root = undefined;
        host?.remove();
        host = undefined;
    });

    it('reads the legacy browser key and writes the common preference key without losing values', async () => {
        localStorage.setItem(key, JSON.stringify(old));
        storage.get.mockResolvedValue(undefined);
        const preference = await import('./pricingStore');
        expect(preference.getFixedOverheads()).toEqual(old);
        preference.setFixedOverheads(edited);
        expect(JSON.parse(localStorage.getItem(`fc_${key}`) ?? 'null')).toEqual(edited);
        expect(storage.set).toHaveBeenCalledWith(key, edited, { debounce: true });
        expect((await import('./pricingStore')).getFixedOverheads()).toEqual(edited);
    });

    it('treats an empty native value as saved data instead of resurrecting the browser fallback', async () => {
        localStorage.setItem(key, JSON.stringify(old));
        storage.get.mockResolvedValue([]);
        const preference = await import('./pricingStore');
        expect(preference.getFixedOverheads()).toEqual([]);
    });

    it('keeps an early edit when a delayed native read completes', async () => {
        let resolve!: (value: unknown) => void;
        storage.get.mockReturnValue(
            new Promise((yes) => {
                resolve = yes;
            }),
        );
        const preference = await import('./pricingStore');
        preference.setFixedOverheads(edited);
        resolve(old);
        await Promise.resolve();
        expect(preference.getFixedOverheads()).toEqual(edited);
        expect(storage.set).toHaveBeenLastCalledWith(key, edited, { debounce: true });
    });

    it('normalizes restored values and synchronizes both mounted readers', async () => {
        storage.get.mockResolvedValue([
            ...old,
            { id: 'negative', name: 'Adjustment', amountPerKg: -5 },
            { id: 'bad', name: 'Invalid', amountPerKg: Number.POSITIVE_INFINITY },
            { id: 'missing' },
        ]);
        const preference = await import('./pricingStore');
        expect(preference.getFixedOverheads()).toEqual([
            ...old,
            { id: 'negative', name: 'Adjustment', amountPerKg: 0 },
        ]);
        function Reader() {
            const rows = preference.useFixedOverheads();
            return createElement(
                'span',
                null,
                rows.reduce((sum, row) => sum + row.amountPerKg, 0),
            );
        }
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root?.render(createElement('div', null, createElement(Reader), createElement(Reader))));
        act(() => preference.setFixedOverheads(edited));
        expect([...host.querySelectorAll('span')].map((span) => span.textContent)).toEqual(['2000', '2000']);
    });
});
