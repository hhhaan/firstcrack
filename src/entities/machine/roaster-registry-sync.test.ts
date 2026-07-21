/**
 * Drives the shipped registry sync gate (scripts/check-roaster-registry.mjs).
 * Failures mean py↔ts roaster keys (or protocol fields) drifted.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const script = join(root, 'scripts/check-roaster-registry.mjs');

describe('check-roaster-registry.mjs', () => {
    it('exits 0 when Python and TypeScript roaster registries match', () => {
        const out = execFileSync(process.execPath, [script], {
            cwd: root,
            encoding: 'utf8',
        });
        expect(out).toMatch(/roaster registry sync: OK/);
        expect(out).toMatch(/key sets: OK/);
        expect(out).toMatch(/per-key protocol fields: OK/);
    });
});
