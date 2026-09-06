import { describe, expect, it } from 'vitest';
import { roastEventLabel, roastPhaseLabel } from './roast-i18n';

const t = (key: string) => `t:${key}`;

describe('roastEventLabel', () => {
    it('maps known event codes to i18n keys without changing the storage code', () => {
        expect(roastEventLabel('Yellow', t)).toBe('t:activeRoast.events.yellow');
        expect(roastEventLabel('FC Start', t)).toBe('t:activeRoast.events.fcStart');
        expect(roastEventLabel('Drop', t)).toBe('t:activeRoast.events.drop');
        expect(roastEventLabel('Charge', t)).toBe('t:activeRoast.events.charge');
    });

    it('passes unknown event types through so stored codes stay visible', () => {
        expect(roastEventLabel('First Crack', t)).toBe('First Crack');
    });
});

describe('roastPhaseLabel', () => {
    it('maps internal phase names to i18n keys', () => {
        expect(roastPhaseLabel('READY', t)).toBe('t:activeRoast.phase.ready');
        expect(roastPhaseLabel('Development', t)).toBe('t:activeRoast.phase.development');
    });

    it('passes unknown phase names through', () => {
        expect(roastPhaseLabel('cooling', t)).toBe('cooling');
    });
});
