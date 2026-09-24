import { describe, expect, it } from 'vitest';
import modalSrc from './NewProfileModal.tsx?raw';

describe('NewProfileModal heater bounds (#435)', () => {
    it('opens the profile heater editor through the React Query status hook', () => {
        expect(modalSrc).toMatch(/ProfileHeaterEventsEditor/);
        expect(modalSrc).not.toMatch(/useEffect/);
        expect(modalSrc).not.toMatch(/getStatus/);
        expect(modalSrc).not.toMatch(/sidecar/);
    });
});
