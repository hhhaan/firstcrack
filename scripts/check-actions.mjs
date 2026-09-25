// actionlint + pinned shellcheck. Same binary on the laptop and in CI.
import { spawnSync } from 'node:child_process';

import { ensurePinnedTool } from './pinned-tool.mjs';

const ACTIONLINT = {
    version: '1.7.12',
    'darwin-arm64': {
        url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_arm64.tar.gz',
        sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
    },
    'darwin-x64': {
        url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_amd64.tar.gz',
        sha256: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
    },
    'linux-x64': {
        url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz',
        sha256: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
    },
    'linux-arm64': {
        url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_arm64.tar.gz',
        sha256: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
    },
};

// v0.11.0 extracts as shellcheck-v0.11.0/shellcheck (--strip-components=1).
const SHELLCHECK = {
    version: '0.11.0',
    'darwin-arm64': {
        url: 'https://github.com/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.darwin.aarch64.tar.xz',
        sha256: '56affdd8de5527894dca6dc3d7e0a99a873b0f004d7aabc30ae407d3f48b0a79',
    },
    'linux-x64': {
        url: 'https://github.com/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.linux.x86_64.tar.xz',
        sha256: '8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198',
    },
};

const platformKey = `${process.platform}-${process.arch}`;

const asset = (table, name) => {
    const found = table[platformKey];
    if (!found) {
        console.error(`check:actions: ${name} has no build for ${platformKey}`);
        process.exit(1);
    }
    return found;
};

const actionlintAsset = asset(ACTIONLINT, 'actionlint');
const shellcheckAsset = asset(SHELLCHECK, 'shellcheck');

const actionlint = await ensurePinnedTool({
    name: 'actionlint',
    version: ACTIONLINT.version,
    url: actionlintAsset.url,
    sha256: actionlintAsset.sha256,
    tarFlags: ['-xzf'],
});
const shellcheck = await ensurePinnedTool({
    name: 'shellcheck',
    version: SHELLCHECK.version,
    url: shellcheckAsset.url,
    sha256: shellcheckAsset.sha256,
    tarFlags: ['-xJf'],
    strip: 1,
});

// -pyflakes= keeps the gate on workflow syntax + shell, not whichever pyflakes is installed.
const run = spawnSync(actionlint, ['-no-color', `-shellcheck=${shellcheck}`, '-pyflakes='], { stdio: 'inherit' });
process.exit(run.status ?? 1);
