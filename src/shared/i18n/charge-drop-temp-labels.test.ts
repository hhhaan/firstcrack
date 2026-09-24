import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhCN from './locales/zh-CN.json';

/** #492: drop must not be labeled as charge (투입). */
const historyDropKeys = [
    ['history.table.dropTemp', (l: typeof en) => l.history.table.dropTemp],
    ['history.expanded.dropTemp', (l: typeof en) => l.history.expanded.dropTemp],
    ['history.compare.dropTemp', (l: typeof en) => l.history.compare.dropTemp],
    ['dashboard.table.dropTemp', (l: typeof en) => l.dashboard.table.dropTemp],
] as const;

describe('charge vs drop temp labels', () => {
    it('Korean History/dashboard dropTemp is 배출, not 투입', () => {
        expect(ko.history.table.dropTemp).toBe('배출 온도');
        expect(ko.history.expanded.dropTemp).toBe('배출 온도');
        expect(ko.history.compare.dropTemp).toBe('배출 온도');
        expect(ko.dashboard.table.dropTemp).toBe('배출 온도');
        expect(ko.history.table.chargeTemp).toBe('투입 온도');
        expect(ko.history.expanded.chargeTemp).toBe('투입 온도');
        expect(ko.history.compare.chargeTemp).toBe('투입 온도');
    });

    it('does not reuse the charge phrase for drop in any locale', () => {
        const locales = { en, ko, ja, 'zh-CN': zhCN };
        for (const [lng, loc] of Object.entries(locales)) {
            const charge = loc.profiles.detail.chargeTemp;
            for (const [path, get] of historyDropKeys) {
                expect(get(loc), `${lng} ${path}`).not.toBe(charge);
            }
        }
    });
});
