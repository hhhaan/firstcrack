import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { expect, test, vi } from 'vitest';

import { trustedExecutable } from './pinned-tool.mjs';

test('only executes tools from directories others cannot modify', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-tool-test-'));
    const bin = join(dir, 'curl');
    const originalPath = process.env.PATH ?? '';
    try {
        writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
        vi.stubEnv('PATH', dir);
        expect(trustedExecutable('curl')).toBe(realpathSync(bin));

        chmodSync(dir, 0o777);
        expect(() => trustedExecutable('curl')).toThrow('no trusted curl executable');

        vi.stubEnv('PATH', `${dir}${delimiter}${originalPath}`);
        expect(trustedExecutable('curl')).not.toBe(bin);
    } finally {
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});
