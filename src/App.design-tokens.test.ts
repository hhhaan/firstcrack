/**
 * Structural guard: DESIGN.md token tables stay byte-aligned with shipped App.css.
 * Parses real App.css (@theme / :root / html.dark) — does not re-implement values.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import designMd from '../DESIGN.md?raw';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appCssPath = join(repoRoot, 'src/App.css');

function loadAppCss(): string {
    return readFileSync(appCssPath, 'utf8');
}

function extractBlock(css: string, openPattern: RegExp): string {
    const m = openPattern.exec(css);
    if (!m) return '';
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') depth -= 1;
        i += 1;
    }
    return css.slice(start, i - 1);
}

function parseVars(block: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /(--(?:color|font|shadow)-[\w-]+)\s*:\s*(.*?);/gs;
    for (const m of block.matchAll(re)) {
        out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    }
    return out;
}

function inventory(css: string) {
    const theme = parseVars(extractBlock(css, /@theme\s*\{/));
    const root = parseVars(extractBlock(css, /:root\s*\{/));
    const dark = parseVars(extractBlock(css, /html\.dark\s*\{/));
    const names = [...new Set([...Object.keys(theme), ...Object.keys(root), ...Object.keys(dark)])].sort();
    const light: Record<string, string> = {};
    const darkEff: Record<string, string> = {};
    for (const n of names) {
        const L = root[n] ?? theme[n];
        if (L != null) light[n] = L;
        darkEff[n] = dark[n] ?? L;
    }
    return { names, light, dark: darkEff };
}

describe('DESIGN.md ↔ App.css design tokens', () => {
    it('lists every --color-*/--font-*/--shadow-* token from App.css with matching Light/Dark values', () => {
        const { names, light, dark } = inventory(loadAppCss());
        expect(names.length).toBeGreaterThan(50);

        const missingNames: string[] = [];
        const missingValues: string[] = [];

        for (const name of names) {
            if (!designMd.includes(name)) {
                missingNames.push(name);
                continue;
            }
            const L = light[name];
            const D = dark[name];
            if (L && !designMd.includes(L)) {
                missingValues.push(`light ${name}=${L}`);
            }
            if (D && !designMd.includes(D)) {
                missingValues.push(`dark ${name}=${D}`);
            }
        }

        expect(missingNames, `tokens missing from DESIGN.md:\n${missingNames.join('\n')}`).toEqual([]);
        expect(missingValues, `values missing from DESIGN.md:\n${missingValues.join('\n')}`).toEqual([]);
    });

    it('keeps known prior-drift tokens correct (oklch light, phase-danger, divider dark)', () => {
        const { light, dark } = inventory(loadAppCss());

        expect(light['--color-sensor-bt']).toBe('oklch(0.6 0.18 155)');
        expect(light['--color-sensor-bt-target']).toBe('oklch(0.6 0.18 155 / 0.55)');
        expect(dark['--color-sensor-bt-target']).toBe('rgba(75, 224, 140, 0.65)');
        expect(light['--color-phase-danger']).toBe('#dc2626');
        expect(dark['--color-phase-danger']).toBe('#ffffff');
        expect(dark['--color-divider']).toBe('#585d61');
        expect(light['--color-palette-yellow']).toBe('oklch(0.78 0.18 88)');
        expect(light['--color-event-mark']).toBe('oklch(0.55 0 0)');
        expect(dark['--color-event-control']).toBe('oklch(0.72 0.17 25)');
        expect(light['--color-control-drum']).toBe('oklch(0.62 0.16 165)');

        // Doc must carry the same effective strings (not stale hex substitutes)
        expect(designMd).toContain(light['--color-sensor-bt']);
        expect(designMd).toContain('#dc2626');
        expect(designMd).toMatch(/--color-phase-danger[\s\S]*?#ffffff|--color-phase-danger.*#ffffff/);
        expect(designMd).toContain(dark['--color-divider']);
        expect(designMd).toContain(light['--color-palette-yellow']);
        expect(designMd).toContain(light['--color-event-mark']);
        expect(designMd).toContain(dark['--color-event-control']);
        expect(designMd).toContain(light['--color-control-drum']);

        // Stale wrong values must not reappear as sensor light colors
        expect(designMd).not.toMatch(/--color-sensor-bt.*#22a85a|#22a85a.*sensor-bt/);
        expect(designMd).not.toContain('#22a85a');
        expect(designMd).not.toContain('#4a85c5');
        expect(designMd).not.toContain('#e8a828');
        for (const obsolete of [
            '--color-event-charge',
            '--color-event-yellow',
            '--color-event-fc-start',
            '--color-event-fc-rolling',
            '--color-event-fc-end',
            '--color-event-end',
            '--color-event-note',
            '--color-event-tp',
            '--color-event-drop',
        ]) {
            expect(loadAppCss()).not.toContain(obsolete);
            expect(designMd).not.toContain(obsolete);
        }
    });

    it('documents philosophy + token source paths', () => {
        expect(designMd).toMatch(/No emoji/i);
        expect(designMd).toMatch(/Lucide/);
        expect(designMd).toMatch(/No gradients/i);
        expect(designMd).toContain('src/App.css');
        expect(designMd).toContain('src/shared/ui/');
        expect(designMd).toMatch(/tabular-nums/);
        expect(designMd).toMatch(/html\[lang=['"]en['"]\]|html\[lang='en'\]/);
    });
});
