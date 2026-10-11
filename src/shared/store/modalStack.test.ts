import { afterEach, describe, expect, it } from 'vitest';
import { useModalStackStore } from './modalStack';

describe('modalStack', () => {
    afterEach(() => {
        useModalStackStore.setState({ openCount: 0 });
    });

    it('tracks nested ModalShell open count', () => {
        const { register, unregister } = useModalStackStore.getState();
        register();
        register();
        expect(useModalStackStore.getState().openCount).toBe(2);
        unregister();
        expect(useModalStackStore.getState().openCount).toBe(1);
        unregister();
        expect(useModalStackStore.getState().openCount).toBe(0);
        unregister();
        expect(useModalStackStore.getState().openCount).toBe(0);
    });
});
