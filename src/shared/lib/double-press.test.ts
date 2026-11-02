import { describe, expect, it } from 'vitest';
import { stepDoublePress } from './double-press';

const down = (chord: string, now: number, repeat = false) => ({ chord, edge: 'down' as const, repeat, now });
const up = (chord: string, now: number) => ({ chord, edge: 'up' as const, now });

describe('stepDoublePress', () => {
    it('ignores a held key and a second press that never released', () => {
        const first = stepDoublePress(null, down('shift+enter', 0));
        const held = stepDoublePress(first.arm, down('shift+enter', 30, true));
        const again = stepDoublePress(held.arm, down('shift+enter', 50));

        expect(held.fire).toBe(false);
        expect(held.arm).toEqual(first.arm);
        expect(again.fire).toBe(false);
    });

    it('fires when the same chord comes back inside the window after release', () => {
        const first = stepDoublePress(null, down('shift+enter', 0));
        const released = stepDoublePress(first.arm, up('enter', 40));
        const second = stepDoublePress(released.arm, down('shift+enter', 80));

        expect(first.fire).toBe(false);
        expect(released.arm?.sawUp).toBe(true);
        expect(second).toEqual({ arm: null, fire: true });
    });

    it('starts over when the second press is late or a different chord', () => {
        const first = stepDoublePress(null, down('shift+enter', 0));
        const released = stepDoublePress(first.arm, up('shift+enter', 20));
        const late = stepDoublePress(released.arm, down('shift+enter', 421));
        const other = stepDoublePress(released.arm, down('shift+1', 40));

        expect(late.fire).toBe(false);
        expect(late.arm).toMatchObject({ chord: 'shift+enter', sawUp: false, at: 421 });
        expect(other.fire).toBe(false);
        expect(other.arm).toMatchObject({ chord: 'shift+1', sawUp: false, at: 40 });
    });
});
