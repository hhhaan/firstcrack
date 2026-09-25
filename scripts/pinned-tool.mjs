// Download a sha256-pinned binary into ~/.cache/fc-desktop and return its path.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
        'curl',
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
    const tar = spawnSync('tar', tarArgs, { stdio: 'inherit' });
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
