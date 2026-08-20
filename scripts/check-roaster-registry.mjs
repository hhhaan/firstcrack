/**
 * Dual roaster-registry sync check.
 * Compares Python connect SSoT vs TS UI mirror:
 *   top-level keys, per-key protocol, form-field keys, pid nullness,
 *   default_params connect keys, capabilities.
 *
 * Usage: node scripts/check-roaster-registry.mjs
 * Wired as: pnpm check:registry (also via pnpm verify)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRoasterRegistries } from './lib/roaster-registry-sync.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PY_PATH = join(root, 'src-tauri/sidecar/roaster_registry.py');
const TS_PATH = join(root, 'src/entities/machine/roasterRegistry.ts');

/** CLI status lines (biome noConsole allows warn/error only). */
const log = (msg) => {
    process.stdout.write(`${msg}\n`);
};

const pyText = readFileSync(PY_PATH, 'utf8');
const tsText = readFileSync(TS_PATH, 'utf8');
const { ok, logs, errors } = compareRoasterRegistries(pyText, tsText);

for (const line of logs) log(line);
if (!ok) {
    for (const line of errors) console.error(line);
    console.error(
        '\nFix: update both src-tauri/sidecar/roaster_registry.py and src/entities/machine/roasterRegistry.ts',
    );
    process.exit(1);
}
log('\nroaster registry sync: OK');
