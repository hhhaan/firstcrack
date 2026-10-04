/**
 * Structural guard: Inter + SUIT are both local @font-face (CSP-safe).
 * Reads shipped App.css + public assets (not a re-implementation).
 * App.css is read via fs — Vite CSS pipeline empties `?raw` for this entry.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import designMd from '../DESIGN.md?raw';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appCssPath = join(repoRoot, 'src/App.css');
const interPath = join(repoRoot, 'public/fonts/InterVariable.woff2');
const suitPath = join(repoRoot, 'public/fonts/SUIT-Variable.woff2');
const pretendardPath = join(repoRoot, 'public/fonts/PretendardVariable.woff2');

function loadAppCss(): string {
    return readFileSync(appCssPath, 'utf8');
}

function extractEnOverrideBlock(css: string): string {
    const m = css.match(/html\[lang=["']en["']\]\s*\{([^}]+)\}/);
    if (!m) throw new Error('html[lang=en] font override block missing from App.css');
    return m[1];
}

describe('Korean font stack (Inter + SUIT)', () => {
    it('declares local Inter + SUIT @font-face and Inter→SUIT stacks', () => {
        const appCss = loadAppCss();
        expect(appCss).toMatch(/font-family:\s*"Inter"/);
        expect(appCss).toMatch(/url\(["']\/fonts\/InterVariable\.woff2["']\)/);
        expect(appCss).toMatch(/font-family:\s*"SUIT"/);
        expect(appCss).toMatch(/url\(["']\/fonts\/SUIT-Variable\.woff2["']\)/);
        expect(appCss).toMatch(/--font-display:\s*"Inter",\s*"SUIT"/);
        expect(appCss).toMatch(/--font-body:\s*"Inter",\s*"SUIT"/);
        expect(appCss).toMatch(/font-family:\s*"Inconsolata"/);
        expect(appCss).toMatch(/url\(["']\/fonts\/Inconsolata-Variable\.woff2["']\)/);
        expect(appCss).toMatch(/--font-inconsolata:\s*"Inconsolata",\s*monospace/);
        expect(appCss).not.toMatch(/fonts\.googleapis\.com|Pretendard/);
    });

    it('serves Inter + SUIT woff2 under public/fonts and drops Pretendard', () => {
        expect(existsSync(interPath), `missing ${interPath}`).toBe(true);
        expect(statSync(interPath).size).toBeGreaterThan(100_000);
        expect(existsSync(suitPath), `missing ${suitPath}`).toBe(true);
        expect(statSync(suitPath).size).toBeGreaterThan(100_000);
        const inconsolataPath = join(repoRoot, 'public/fonts/Inconsolata-Variable.woff2');
        expect(existsSync(inconsolataPath), `missing ${inconsolataPath}`).toBe(true);
        expect(statSync(inconsolataPath).size).toBeGreaterThan(20_000);
        expect(existsSync(pretendardPath), 'Pretendard asset must be removed').toBe(false);
    });

    it('omits Korean fallback on html[lang=en] but keeps Inter', () => {
        const en = extractEnOverrideBlock(loadAppCss());
        expect(en).toMatch(/"Inter"/);
        expect(en).not.toMatch(/SUIT|Pretendard/);
    });

    it('documents local Inter + SUIT (not CDN / Pretendard) in DESIGN.md', () => {
        // Match App.css stacks: double-quoted Inter + SUIT (or single-quoted legacy form)
        expect(designMd).toMatch(/["']Inter["'],\s*["']SUIT["']/);
        expect(designMd).toMatch(/public\/fonts\/InterVariable\.woff2/);
        expect(designMd).toMatch(/public\/fonts\/SUIT-Variable\.woff2/);
        expect(designMd).not.toMatch(/fonts\.googleapis\.com|Pretendard/);
    });
});
