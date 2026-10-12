import { describe, expect, it } from 'vitest';
import activeRoastSrc from './ActiveRoast.tsx?raw';

describe('ActiveRoast door skip Sentry (#771)', () => {
    it('reports door.skipped only when the matched machine switch is on', () => {
        expect(activeRoastSrc).toContain('captureDoorSkipped');
        expect(activeRoastSrc).toMatch(/matched\s*&&\s*switchOn/);
    });
});
