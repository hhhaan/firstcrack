import * as Sentry from '@sentry/react';
import { logger } from '@shared/lib/logger';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { check } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useRef, useState } from 'react';

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'applying' | 'error';

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
    /** 조용히 체크 → 다운로드 시작. DEV 모드면 아무 일도 안 함. */
    checkAndDownload: () => Promise<void>;
    /** 앱 재시작 (업데이트 적용) */
    applyAndRelaunch: () => Promise<void>;
    /** DEV 전용: ready 상태를 강제로 만들어 dialog/UI 미리보기 */
    mockReady: (version: string) => void;
}

const INITIAL_STATE: UpdateState = {
    status: 'idle',
    version: null,
    progress: 0,
    error: null,
};

const MAX_RETRY_ATTEMPTS = 3;

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
// 시스템 알림: floating 버튼이 이미 존재하므로 비활성화
// let permissionReady: Promise<boolean> | null = null;
// const ensurePermission = async (): Promise<boolean> => {
//     if (permissionReady) return permissionReady;
//     permissionReady = (async () => {
//         if (await isPermissionGranted()) return true;
//         const result = await requestPermission();
//         return result === 'granted';
//     })();
//     return permissionReady;
// };

export const useUpdateChecker = (): UseUpdateCheckerReturn => {
    const [state, setState] = useState<UpdateState>(INITIAL_STATE);
    const downloadedRef = useRef(0);
    const totalRef = useRef<number | undefined>(undefined);
    const statusRef = useRef<UpdateStatus>('idle');
    const versionRef = useRef<string | null>(null);
    const updateRef = useRef<Awaited<ReturnType<typeof check>>>(null);

    // 상태를 ref에 동기화 (useCallback deps=[] 에서도 최신 상태 읽기 위함)
    useEffect(() => {
        statusRef.current = state.status;
    }, [state.status]);

    const checkAndDownload = useCallback(async () => {
        if (import.meta.env.DEV) return;
        if (statusRef.current === 'ready') return;

        setState((prev) => ({ ...prev, status: 'checking', error: null }));

        try {
            const update = await check();
            if (!update) {
                clearLastDownloadedVersion();
                clearRetryAttempts();
                setState(INITIAL_STATE);
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
                        extra: { currentVersion: update.currentVersion, availableVersion: update.version, attempts },
                    });
                    setState({ status: 'error', version: update.version, progress: 0, error: msg });
                    return;
                }

                // retry: 아래로 fall-through → downloadAndInstall 재시도
            }

            // 새 버전 발견 — 백그라운드 다운로드 시작
            downloadedRef.current = 0;
            totalRef.current = undefined;
            setState({ status: 'downloading', version: update.version, progress: 0, error: null });

            const isWindows = platform() === 'windows';
            if (isWindows) {
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
            } else {
                await update.downloadAndInstall((event: DownloadEvent) => {
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
            }

            versionRef.current = update.version;
            clearRetryAttempts();

            setState((prev) => ({ ...prev, status: 'ready', progress: 100 }));

            // 시스템 알림: floating 버튼이 이미 강제 수단이므로 비활성화
            // ensurePermission().then((granted) => {
            //     if (granted) {
            //         sendNotification({
            //             title: 'First Crack 업데이트 준비 완료',
            //             body: `v${update.version} — 앱을 재시작하면 적용됩니다.`,
            //         });
            //     }
            // });
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'updater.checkError';
            logger.capture(error, { context: 'updater' });
            setState({ status: 'error', version: null, progress: 0, error: msg });
        }
    }, []);

    const applyAndRelaunch = useCallback(async () => {
        setState((prev) => ({ ...prev, status: 'applying', error: null }));
        try {
            const isWindows = platform() === 'windows';
            if (isWindows) {
                writeLastDownloadedVersion(versionRef.current ?? '');
                await updateRef.current?.install();
                // Windows: install() 시점에 앱 강제 종료됨 — 아래 코드는 도달하지 않음
            } else {
                writeLastDownloadedVersion(versionRef.current ?? '');
                await invoke('relaunch_for_update');
            }
        } catch (error) {
            clearLastDownloadedVersion();
            const msg = error instanceof Error ? error.message : 'updater.relaunchError';
            Sentry.captureException(error, { extra: { context: 'relaunch_for_update' } });
            setState((prev) => ({ ...prev, status: 'error', error: msg }));
        }
    }, []);

    const mockReady = useCallback((version: string) => {
        if (!import.meta.env.DEV) return;
        setState({ status: 'ready', version, progress: 100, error: null });
    }, []);

    return { state, checkAndDownload, applyAndRelaunch, mockReady };
};
