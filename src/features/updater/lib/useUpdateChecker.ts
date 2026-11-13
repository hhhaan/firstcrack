import * as Sentry from '@sentry/react';
import { logger } from '@shared/lib/logger';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { check } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useRef, useState } from 'react';

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'applying'
    | 'error'
    | 'current';

export interface UpdateState {
    status: UpdateStatus;
    /** 새 버전 식별자 (e.g. "1.0.5") */
    version: string | null;
    /** 다운로드 진행률 0–100 */
    progress: number;
    /** 에러 메시지 */
    error: string | null;
}

export interface UseUpdateCheckerReturn {
    state: UpdateState;
    /** 버전만 확인한다. 다운로드하지 않는다. */
    checkForUpdate: () => Promise<void>;
    /** 자동 확인 또는 수동 업데이트 버튼에서 체크 후 다운로드만 한다. DEV에서는 건너뛴다. */
    checkAndDownload: () => Promise<void>;
    /** 다운로드한 업데이트 설치 후 앱 재시작 */
    applyAndRelaunch: () => Promise<void>;
}

const INITIAL_STATE: UpdateState = {
    status: 'idle',
    version: null,
    progress: 0,
    error: null,
};

const MAX_RETRY_ATTEMPTS = 3;

// 원격 버전이 현재와 다르면 설치한다. 낮은 버전도 받아서, 이 빌드 이후에는 R2 latest.json 롤백이 이미 설치된 앱을 내린다.
const UPDATE_CHECK = { allowDowngrades: true } as const;

const LAST_DOWNLOADED_KEY = 'fc_updater_last_downloaded';

const readLastDownloadedVersion = () => localStorage.getItem(LAST_DOWNLOADED_KEY);
const writeLastDownloadedVersion = (version: string) => {
    localStorage.setItem(LAST_DOWNLOADED_KEY, version);
};
const clearLastDownloadedVersion = () => {
    localStorage.removeItem(LAST_DOWNLOADED_KEY);
};

const RETRY_ATTEMPTS_KEY = 'fc_updater_restart_attempts';

const readRetryAttempts = (): number => {
    const v = localStorage.getItem(RETRY_ATTEMPTS_KEY);
    return v ? parseInt(v, 10) : 0;
};
const incrementRetryAttempts = () => {
    localStorage.setItem(RETRY_ATTEMPTS_KEY, String(readRetryAttempts() + 1));
};
const clearRetryAttempts = () => {
    localStorage.removeItem(RETRY_ATTEMPTS_KEY);
};

export const useUpdateChecker = (): UseUpdateCheckerReturn => {
    const [state, setState] = useState<UpdateState>(INITIAL_STATE);
    const downloadedRef = useRef(0);
    const totalRef = useRef<number | undefined>(undefined);
    const statusRef = useRef<UpdateStatus>('idle');
    const versionRef = useRef<string | null>(null);
    const updateRef = useRef<Awaited<ReturnType<typeof check>>>(null);
    const tailRef = useRef<Promise<void>>(Promise.resolve());

    const blocksUpdate = useCallback(
        () => statusRef.current === 'ready' || statusRef.current === 'downloading' || statusRef.current === 'applying',
        [],
    );

    const enqueue = useCallback((task: () => Promise<void>) => {
        const run = tailRef.current.then(task, task);
        tailRef.current = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }, []);

    // 상태를 ref에 동기화 (useCallback deps=[] 에서도 최신 상태 읽기 위함)
    useEffect(() => {
        statusRef.current = state.status;
    }, [state.status]);

    const checkForUpdate = useCallback(async () => {
        await enqueue(async () => {
            if (blocksUpdate()) return;

            statusRef.current = 'checking';
            setState((prev) => ({ ...prev, status: 'checking', error: null }));

            if (import.meta.env.DEV) {
                await new Promise((resolve) => setTimeout(resolve, 600));
                if (blocksUpdate()) return;
                statusRef.current = 'current';
                setState({ status: 'current', version: null, progress: 0, error: null });
                return;
            }

            try {
                const update = await check(UPDATE_CHECK);
                if (blocksUpdate()) return;
                if (!update) {
                    clearLastDownloadedVersion();
                    clearRetryAttempts();
                    statusRef.current = 'current';
                    setState({ status: 'current', version: null, progress: 0, error: null });
                    return;
                }
                statusRef.current = 'available';
                setState({ status: 'available', version: update.version, progress: 0, error: null });
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'updater.checkError';
                logger.capture(error, { context: 'updater' });
                statusRef.current = 'error';
                setState({ status: 'error', version: null, progress: 0, error: msg });
            }
        });
    }, [blocksUpdate, enqueue]);

    const checkAndDownload = useCallback(async () => {
        await enqueue(async () => {
            if (blocksUpdate()) return;
            if (import.meta.env.DEV) return;

            statusRef.current = 'checking';
            setState((prev) => ({ ...prev, status: 'checking', error: null }));

            try {
                const update = await check(UPDATE_CHECK);
                if (!update) {
                    clearLastDownloadedVersion();
                    clearRetryAttempts();
                    statusRef.current = 'current';
                    setState({ status: 'current', version: null, progress: 0, error: null });
                    return;
                }

                const lastDownloaded = readLastDownloadedVersion();
                if (lastDownloaded === update.version && update.currentVersion !== update.version) {
                    incrementRetryAttempts();
                    clearLastDownloadedVersion();

                    const attempts = readRetryAttempts();
                    if (attempts >= MAX_RETRY_ATTEMPTS) {
                        const msg = 'updater.loopGuardError';
                        Sentry.captureMessage('[updater] loop-guard triggered', {
                            level: 'warning',
                            extra: {
                                currentVersion: update.currentVersion,
                                availableVersion: update.version,
                                attempts,
                            },
                        });
                        statusRef.current = 'error';
                        setState({ status: 'error', version: update.version, progress: 0, error: msg });
                        return;
                    }

                    // retry: 아래로 fall-through → 다운로드 재시도
                }

                // 백그라운드 다운로드 — 설치는 재시작 버튼에서 수행한다.
                downloadedRef.current = 0;
                totalRef.current = undefined;
                statusRef.current = 'downloading';
                setState({ status: 'downloading', version: update.version, progress: 0, error: null });

                updateRef.current = update;
                await update.download((event: DownloadEvent) => {
                    if (event.event === 'Started') {
                        totalRef.current = event.data.contentLength;
                    } else if (event.event === 'Progress') {
                        downloadedRef.current += event.data.chunkLength;
                        const total = totalRef.current;
                        const pct =
                            total && total > 0
                                ? Math.round((downloadedRef.current / total) * 100)
                                : Math.min(downloadedRef.current / 1024 / 50, 95);
                        setState((prev) => ({ ...prev, progress: Math.min(pct, 99) }));
                    }
                });

                versionRef.current = update.version;
                clearRetryAttempts();

                statusRef.current = 'ready';
                setState((prev) => ({ ...prev, status: 'ready', progress: 100 }));
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'updater.checkError';
                logger.capture(error, { context: 'updater' });
                statusRef.current = 'error';
                setState({ status: 'error', version: null, progress: 0, error: msg });
            }
        });
    }, [blocksUpdate, enqueue]);

    const applyAndRelaunch = useCallback(async () => {
        statusRef.current = 'applying';
        setState((prev) => ({ ...prev, status: 'applying', error: null }));
        try {
            writeLastDownloadedVersion(versionRef.current ?? '');
            await updateRef.current?.install();
            // Windows는 install()에서 앱을 종료한다.
            if (platform() !== 'windows') await invoke('relaunch_for_update');
        } catch (error) {
            clearLastDownloadedVersion();
            const msg = error instanceof Error ? error.message : 'updater.relaunchError';
            Sentry.captureException(error, { extra: { context: 'relaunch_for_update' } });
            statusRef.current = 'error';
            setState((prev) => ({ ...prev, status: 'error', error: msg }));
        }
    }, []);

    return { state, checkForUpdate, checkAndDownload, applyAndRelaunch };
};
