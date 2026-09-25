// Download a sha256-pinned binary into ~/.cache/fc-desktop and return its path.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export function trustedExecutable(name) {
    const uid = process.getuid();
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
        if (!dir) continue;
        try {
            const bin = realpathSync(join(dir, name));
            const file = statSync(bin);
            accessSync(bin, constants.X_OK);
            if (!file.isFile() || file.mode & 0o022 || (file.uid !== 0 && file.uid !== uid)) continue;
            let parent = dirname(bin);
            for (;;) {
                const { mode, uid: owner } = statSync(parent);
                if ((owner !== 0 && owner !== uid) || (mode & 0o022 && !(mode & 0o1000))) break;
                const next = dirname(parent);
                if (next === parent) return bin;
                parent = next;
            }
        } catch {
            // Try the next PATH entry.
        }
    }
    throw new Error(`no trusted ${name} executable on PATH`);
}

/**
 * @param {{ name: string, version: string, url: string, sha256: string, tarFlags: string[], strip?: number }} spec
 */
export async function ensurePinnedTool(spec) {
    const dir = join(homedir(), '.cache', 'fc-desktop', spec.name, spec.version);
    const bin = join(dir, spec.name);
    try {
        await stat(bin);
        return bin;
    } catch {
        // download below
    }

    await mkdir(dir, { recursive: true });
    const archive = join(dir, 'archive');
    const curl = spawnSync(
        trustedExecutable('curl'),
        ['-fsSL', '--proto', '=https', '--tlsv1.2', '--retry', '3', '-o', archive, spec.url],
        { stdio: 'inherit' },
    );
    if (curl.status !== 0) {
        await rm(archive, { force: true });
        throw new Error(`download failed: ${spec.url}`);
    }

    const hash = createHash('sha256')
        .update(await readFile(archive))
        .digest('hex');
    if (hash !== spec.sha256) {
        await rm(archive, { force: true });
        throw new Error(`${spec.name} sha256 mismatch: got ${hash}`);
    }

    const tarArgs = [...spec.tarFlags, archive, '-C', dir];
    if (spec.strip) tarArgs.push(`--strip-components=${spec.strip}`);
    const tar = spawnSync(trustedExecutable('tar'), tarArgs, { stdio: 'inherit' });
    await rm(archive, { force: true });
    if (tar.status !== 0) throw new Error(`extract failed: ${spec.name}`);

    try {
        await stat(bin);
    } catch {
        throw new Error(`${spec.name} binary missing after extract`);
    }
    await chmod(bin, 0o755);
    return bin;
}
