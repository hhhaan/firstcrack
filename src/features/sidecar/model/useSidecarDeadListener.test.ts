// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Sidecar-dead banner UX contract (App.tsx + useSidecarDeadListener):
 * isDead latches on sidecar-dead and clears when GET /status is healthy.
 */
describe('useSidecarDeadListener source contract', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useSidecarDeadListener.ts'), 'utf8');

    it('listens for sidecar-dead and clears on healthy /status', () => {
        expect(src).toContain("listen<null>('sidecar-dead'");
        expect(src).toContain("'sidecar-dead'");
        expect(src).toContain("'status-healthy'");
        expect(src).toContain('sidecar.getStatus');
        expect(src).toContain("invoke('relaunch_for_update')");
    });
});
