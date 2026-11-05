import { describe, expect, it } from 'vitest';
import { createActionOpIdSession } from './action-op-id';

describe('createActionOpIdSession', () => {
    it('reuses the same id until markSucceeded', () => {
        let n = 0;
        const session = createActionOpIdSession(() => `id-${++n}`);
        expect(session.getOrCreate()).toBe('id-1');
        expect(session.getOrCreate()).toBe('id-1');
        session.markSucceeded();
        expect(session.getOrCreate()).toBe('id-2');
        expect(session.peek()).toBe('id-2');
    });

    it('mints a new id when the request key changes', () => {
        let n = 0;
        const session = createActionOpIdSession(() => `id-${++n}`);
        expect(session.getOrCreate('a')).toBe('id-1');
        expect(session.getOrCreate('a')).toBe('id-1');
        expect(session.getOrCreate('b')).toBe('id-2');
    });

    it('reset drops pending id without success', () => {
        let n = 0;
        const session = createActionOpIdSession(() => `id-${++n}`);
        session.getOrCreate();
        session.reset();
        expect(session.peek()).toBeNull();
        expect(session.getOrCreate()).toBe('id-2');
    });
});
