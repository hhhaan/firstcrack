/**
 * Dual roaster-registry sync (py ↔ ts).
 * The parser lives in ONE place — scripts/check-roaster-registry.mjs — and this
 * test just runs that CLI, so vitest and `pnpm check:registry` cannot diverge.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/check-roaster-registry.mjs');

describe('roaster registry py↔ts sync', () => {
    it('check:registry CLI passes', () => {
        try {
            execFileSync(process.execPath, [CLI], { encoding: 'utf8' });
        } catch (e) {
            const err = e as { stdout?: string; stderr?: string; message: string };
            expect.fail(`check:registry failed\n${err.stdout ?? ''}${err.stderr ?? err.message}`);
        }
    });
});
