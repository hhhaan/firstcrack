import * as Sentry from '@sentry/react';
import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { check } from '@tauri-apps/plugin-updater';
import { useCallback, useRef, useState } from 'react';

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
}

const INITIAL_STATE: UpdateState = {
    status: 'idle',
    version: null,
    progress: 0,
    error: null,
};

const LAST_DOWNLOADED_KEY = 'fc_updater_last_downloaded';

const readLastDownloadedVersion = () => localStorage.getItem(LAST_DOWNLOADED_KEY);
const writeLastDownloadedVersion = (version: string) => {
    localStorage.setItem(LAST_DOWNLOADED_KEY, version);
};
const clearLastDownloadedVersion = () => {
    localStorage.removeItem(LAST_DOWNLOADED_KEY);
};

/** 시스템 알림 권한 확보 (앱 생애 첫 한 번만 묻고 이후 재사용) */
let permissionReady: Promise<boolean> | null = null;
const ensurePermission = async (): Promise<boolean> => {
    if (permissionReady) return permissionReady;
    permissionReady = (async () => {
        if (await isPermissionGranted()) return true;
        const result = await requestPermission();
        return result === 'granted';
    })();
    return permissionReady;
};

export const useUpdateChecker = (): UseUpdateCheckerReturn => {
    const [state, setState] = useState<UpdateState>(INITIAL_STATE);
    const downloadedRef = useRef(0);
    const totalRef = useRef<number | undefined>(undefined);

    const checkAndDownload = useCallback(async () => {
        if (import.meta.env.DEV) return;

        setState((prev) => ({ ...prev, status: 'checking', error: null }));

        try {
            const update = await check();
            if (!update) {
                clearLastDownloadedVersion();
                setState(INITIAL_STATE);
                return;
            }

            const lastDownloaded = readLastDownloadedVersion();
            if (lastDownloaded === update.version && update.currentVersion !== update.version) {
                const msg =
                    '업데이트가 적용되지 않았습니다. dmg에서 앱을 다시 설치하거나 최신 버전을 수동으로 받아 주세요.';
                Sentry.captureMessage('[updater] loop-guard triggered', {
                    level: 'warning',
                    extra: { currentVersion: update.currentVersion, availableVersion: update.version },
                });
                setState({ status: 'error', version: update.version, progress: 0, error: msg });
                return;
            }

            // 새 버전 발견 — 백그라운드 다운로드 시작
            downloadedRef.current = 0;
            totalRef.current = undefined;
            setState({ status: 'downloading', version: update.version, progress: 0, error: null });

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

            writeLastDownloadedVersion(update.version);

            setState((prev) => ({ ...prev, status: 'ready', progress: 100 }));

            // 시스템 알림 발송 (권한 확인 후)
            ensurePermission().then((granted) => {
                if (granted) {
                    sendNotification({
                        title: 'First Crack 업데이트 준비 완료',
                        body: `v${update.version} — 앱을 재시작하면 적용됩니다.`,
                    });
                }
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : '업데이트 확인 중 오류가 발생했습니다.';
            console.error('[updater]', msg, error);
            setState({ status: 'error', version: null, progress: 0, error: msg });
        }
    }, []);

    const applyAndRelaunch = useCallback(async () => {
        setState((prev) => ({ ...prev, status: 'applying', error: null }));
        try {
            await invoke('relaunch_for_update');
        } catch (error) {
            const msg = error instanceof Error ? error.message : '재시작에 실패했습니다.';
            Sentry.captureException(error, { extra: { context: 'relaunch_for_update' } });
            console.error('[updater] relaunch failed:', error);
            setState((prev) => ({ ...prev, status: 'error', error: msg }));
        }
    }, []);

    return { state, checkAndDownload, applyAndRelaunch };
};
