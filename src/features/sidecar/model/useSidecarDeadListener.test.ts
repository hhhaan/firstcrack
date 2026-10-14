// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Sidecar-dead banner UX contract (App.tsx + useSidecarDeadListener):
 * isDead latches true and has no recovery clear — banner stays until remount.
 * Drive the shipped source so a future auto-clear shows up as a failing assertion
 * only if someone adds setIsDead(false) without a deliberate recovery path test.
 */
describe('useSidecarDeadListener source contract', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useSidecarDeadListener.ts'), 'utf8');

    it('listens for sidecar-dead and only latches isDead true (no auto-clear)', () => {
        expect(src).toContain("listen<null>('sidecar-dead'");
        expect(src).toContain('setIsDead(true)');
        expect(src).toContain('if (cancelled) fn()');
        // Recovery would need setIsDead(false) on status healthy — currently absent.
        expect(src.includes('setIsDead(false)')).toBe(false);
    });
});
