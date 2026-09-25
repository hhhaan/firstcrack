// zizmor offline. Fails on high-confidence high-severity findings. Policy: .github/zizmor.yml.
import { spawnSync } from 'node:child_process';

import { ensurePinnedTool } from './pinned-tool.mjs';

const ZIZMOR = {
    version: '1.30.1',
    'darwin-arm64': {
        url: 'https://github.com/zizmorcore/zizmor/releases/download/v1.30.1/zizmor-aarch64-apple-darwin.tar.gz',
        sha256: 'e28d22b087f9ebb8d99da6e740d348c930f559961c7c3f12badda54f882195a2',
    },
    'linux-x64': {
        url: 'https://github.com/zizmorcore/zizmor/releases/download/v1.30.1/zizmor-x86_64-unknown-linux-gnu.tar.gz',
        sha256: 'e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a',
    },
};

const platformKey = `${process.platform}-${process.arch}`;
const asset = ZIZMOR[platformKey];
if (!asset) {
    console.error(`check:zizmor: no build for ${platformKey}`);
    process.exit(1);
}

const bin = await ensurePinnedTool({
    name: 'zizmor',
    version: ZIZMOR.version,
    url: asset.url,
    sha256: asset.sha256,
    tarFlags: ['-xzf'],
});

const run = spawnSync(bin, ['--offline', '--min-severity', 'high', '--min-confidence', 'high', '.'], {
    stdio: 'inherit',
});
process.exit(run.status ?? 1);
