#!/usr/bin/env node
/**
 * Same major/minor check as `tauri build` (tauri-cli info::plugins::check_mismatched_packages).
 * Reads the lockfiles, so a one-sided Dependabot bump fails in CI instead of at release.
 *
 * Pairs: `tauri` ↔ `@tauri-apps/api`, `tauri-plugin-<name>` ↔ `@tauri-apps/plugin-<name>`.
 * A side that is not installed is skipped (rust-only plugins, `@tauri-apps/cli`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const majorMinor = (version) => {
    const [major, minor] = version.split('.');
    return `${major}.${minor}`;
};

/** @param {string} lockText */
export const npmVersionsFromLock = (lockText) => {
    const versions = new Map();
    const re = /'(@tauri-apps\/(?:api|plugin-[^']+))':\n\s+specifier:[^\n]*\n\s+version: ([^\s(]+)/g;
    for (const match of lockText.matchAll(re)) versions.set(match[1], match[2]);
    return versions;
};

/** @param {string} lockText */
export const crateVersionsFromLock = (lockText) => {
    const versions = new Map();
    const re = /\[\[package\]\]\nname = "(tauri(?:-plugin-[^"]+)?)"\nversion = "([^"]+)"/g;
    for (const match of lockText.matchAll(re)) {
        const list = versions.get(match[1]) ?? [];
        list.push(match[2]);
        versions.set(match[1], list);
    }
    return versions;
};

const crateNameFor = (npmName) => {
    if (npmName === '@tauri-apps/api') return 'tauri';
    if (npmName.startsWith('@tauri-apps/plugin-')) {
        return `tauri-plugin-${npmName.slice('@tauri-apps/plugin-'.length)}`;
    }
    return null;
};

/**
 * @param {Map<string, string>} npm
 * @param {Map<string, string[]>} crates
 */
export const mismatchedPairs = (npm, crates) => {
    const mismatches = [];
    for (const [npmName, npmVersion] of npm) {
        const crateName = crateNameFor(npmName);
        const crateVersions = crateName ? crates.get(crateName) : undefined;
        if (!crateVersions) continue;
        for (const crateVersion of crateVersions) {
            if (majorMinor(crateVersion) !== majorMinor(npmVersion)) {
                mismatches.push({ crateName, crateVersion, npmName, npmVersion });
            }
        }
    }
    return mismatches;
};

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
    const npm = npmVersionsFromLock(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
    const crates = crateVersionsFromLock(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'));
    const mismatches = mismatchedPairs(npm, crates);
    if (mismatches.length > 0) {
        const lines = mismatches.map(
            (pair) => `  ${pair.crateName} (v${pair.crateVersion}) : ${pair.npmName} (v${pair.npmVersion})`,
        );
        console.error(
            `Tauri npm packages and Rust crates differ on major/minor (tauri build rejects this):\n${lines.join('\n')}`,
        );
        process.exit(1);
    }
}
