import { describe, expect, it } from 'vitest';
import { nextGlobalDrop } from './useGlobalDropShortcut';

describe('nextGlobalDrop', () => {
    it('fires a single binding on press and ignores the release', () => {
        expect(nextGlobalDrop(1, null, 'Pressed', 'mod+shift+d', 0).fire).toBe(true);
        expect(nextGlobalDrop(1, null, 'Released', 'mod+shift+d', 10).fire).toBe(false);
    });

    it('fires a double binding only on the second press', () => {
        const first = nextGlobalDrop(2, null, 'Pressed', 'shift+enter', 0);
        const released = nextGlobalDrop(2, first.arm, 'Released', 'shift+enter', 40);
        const second = nextGlobalDrop(2, released.arm, 'Pressed', 'shift+enter', 120);
        const held = nextGlobalDrop(2, first.arm, 'Pressed', 'shift+enter', 50);

        expect(first.fire).toBe(false);
        expect(released.fire).toBe(false);
        expect(second.fire).toBe(true);
        expect(held.fire).toBe(false);
    });
});
