// Production Vite bundle regression. Measures the JS/CSS Tauri ships (dist/assets),
// not public fonts or logos. Env is fixed so a local .env cannot move the baseline.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BASELINE_PATH = 'scripts/bundle-baseline.json';
const OUT_DIR = 'node_modules/.cache/bundle-check';
// Headroom from the measured ~1.05MB JS gzip baseline: 8% or 80KiB, whichever is larger.
// CSS is ~17KiB gzip: 50% or 12KiB. A normal screen stays inside; a whole library does not.
const JS_RATIO = 0.08;
const JS_FLOOR = 80 * 1024;
const CSS_RATIO = 0.5;
const CSS_FLOOR = 12 * 1024;

const cacheDir = resolve('node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const tempDir = mkdtempSync(join(cacheDir, 'bundle-tmp-'));
const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME || homedir(),
    USER: process.env.USER ?? '',
    TMPDIR: tempDir,
    LANG: 'C.UTF-8',
    CI: 'true',
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'ci-anon-key-not-a-secret',
    VITE_CUPPING_PUBLIC_BASE_URL: '',
    VITE_E2E: '',
    VITE_SENTRY_SMOKE: '',
    PUBLIC_TAURI_REDIRECT: 'firstcrack://auth/callback',
    PUBLIC_SITE_URL: '',
};

const vite = join(dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin', 'vite.js');
let build;
try {
    build = spawnSync(process.execPath, [vite, 'build', '--outDir', OUT_DIR, '--emptyOutDir'], {
        env,
        stdio: 'inherit',
    });
} finally {
    rmSync(tempDir, { recursive: true, force: true });
}
if (build.status !== 0) process.exit(build.status ?? 1);

const gzipFile = (file) => gzipSync(readFileSync(file)).length;

const filesIn = (dir) => {
    const out = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        out.push(path);
    }
    return out;
};

const assets = filesIn(join(OUT_DIR, 'assets'));
const js = assets.filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
const css = assets.filter((file) => file.endsWith('.css'));
if (js.length === 0) {
    console.error('check:bundle: no JS in assets/');
    process.exit(1);
}

const measured = {
    jsGzip: js.reduce((sum, file) => sum + gzipFile(file), 0),
    cssGzip: css.reduce((sum, file) => sum + gzipFile(file), 0),
};

const budget = (base, ratio, floor) => Math.max(Math.round(base * ratio), floor);
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

if (process.argv.includes('--update')) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(measured, null, 4)}\n`);
    console.log(`check:bundle: wrote ${BASELINE_PATH} js=${kib(measured.jsGzip)} css=${kib(measured.cssGzip)}`);
    process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const jsBudget = budget(baseline.jsGzip, JS_RATIO, JS_FLOOR);
const cssBudget = budget(baseline.cssGzip, CSS_RATIO, CSS_FLOOR);
const jsDelta = measured.jsGzip - baseline.jsGzip;
const cssDelta = measured.cssGzip - baseline.cssGzip;

console.log(
    `check:bundle: js ${kib(measured.jsGzip)} (${jsDelta >= 0 ? '+' : ''}${kib(jsDelta)}, budget ${kib(jsBudget)})`,
);
console.log(
    `check:bundle: css ${kib(measured.cssGzip)} (${cssDelta >= 0 ? '+' : ''}${kib(cssDelta)}, budget ${kib(cssBudget)})`,
);

let failed = false;
if (jsDelta > jsBudget) {
    console.error(`check:bundle: JS gzip grew ${kib(jsDelta)} (budget ${kib(jsBudget)})`);
    failed = true;
}
if (cssDelta > cssBudget) {
    console.error(`check:bundle: CSS gzip grew ${kib(cssDelta)} (budget ${kib(cssBudget)})`);
    failed = true;
}
if (failed) process.exit(1);
