import type { FirescopeSettingsSnapshot } from '@shared/types/firescope';
import type { NetworkHost, PidRuntime, SerialPort, SidecarStatus, TemperatureReading } from '@shared/types/sidecar';
import { invoke } from '@tauri-apps/api/core';
import { isSidecarStartingError } from './errorMessage';
import { logger } from './logger';

export const SIDECAR_BASE = 'http://127.0.0.1:9999';

/** 폴링·상태 조회 등 즉답 요청 기준 */
const DEFAULT_TIMEOUT_MS = 5000;
/** connect는 사이드카 내부 핸드셰이크가 더 길다 (Kaleido 15s, Phidget attach 최대 10s) */
const CONNECT_TIMEOUT_MS = 20_000;
/** /scan-network: /24 TCP probe, ~2–3s typical, headroom for slow LANs */
const SCAN_NETWORK_TIMEOUT_MS = 10_000;

const TOKEN_HEADER = 'X-Sidecar-Token';

/**
 * 사이드카 HTTP 토큰. Tauri가 spawn 시 env로 주입한 값을 Rust 커맨드로 받아온다.
 * 브라우저(web-only dev)에서는 invoke가 실패하므로 null → 헤더 없이 호출하고,
 * 이때 사이드카도 SIDECAR_TOKEN 없이 떠 있어 인증을 건너뛴다.
 */
let tokenPromise: Promise<string | null> | null = null;
const getSidecarToken = (): Promise<string | null> => {
    // 실패는 캐시하지 않는다 — 일시 실패를 물고 있으면 이후 모든 요청이 401이 된다
    tokenPromise ??= invoke<string>('sidecar_token').catch(() => {
        tokenPromise = null;
        return null;
    });
    return tokenPromise;
};

const STARTUP_RETRY_GAP_MS = 400;
const CONNECT_RETRY_BUDGET_MS = 8_000;
const READY_RETRY_BUDGET_MS = 30_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function retryWhileSidecarStarts<T>(operation: () => Promise<T>, budgetMs: number): Promise<T> {
    const deadline = Date.now() + budgetMs;
    for (;;) {
        try {
            return await operation();
        } catch (error) {
            if (!isSidecarStartingError(error)) throw error;
            if (Date.now() >= deadline) {
                logger.error('[sidecar] startup retry exhausted:', error);
                throw error;
            }
            await wait(STARTUP_RETRY_GAP_MS);
        }
    }
}

async function request<T>(
    path: string,
    init?: RequestInit,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    reportErrors = true,
): Promise<T> {
    try {
        const token = await getSidecarToken();
        const res = await fetch(`${SIDECAR_BASE}${path}`, {
            // Live BT/status must not be reused from the HTTP cache. A cached 200
            // while /temperatures is blocked looks like a healthy reading and
            // resets the unstable-link streak.
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { [TOKEN_HEADER]: token } : {}),
            },
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
            if (reportErrors) logger.error(`[sidecar] ${init?.method ?? 'GET'} ${path} 실패:`, msg);
            throw new Error(msg);
        }
        return await (res.json() as Promise<T>);
    } catch (err) {
        if (reportErrors && !(err instanceof Error && err.message.startsWith('HTTP'))) {
            logger.error(`[sidecar] ${path} 네트워크 오류:`, err);
        }
        throw err;
    }
}

export const sidecar = {
    getFirescopeSettings: () => request<FirescopeSettingsSnapshot>('/imports/firescope', undefined, 20_000, false),

    getStatus: () => request<SidecarStatus>('/status'),

    /** 재시작 직후 30초 예산 동안 사이드카 기동 실패를 삼키고 첫 정상 상태를 기다린다. */
    waitUntilReady: () =>
        retryWhileSidecarStarts(
            () => request<SidecarStatus>('/status', undefined, DEFAULT_TIMEOUT_MS, false),
            READY_RETRY_BUDGET_MS,
        ),

    connect: (roasterKey: string, params: Record<string, unknown>) =>
        retryWhileSidecarStarts(
            () =>
                request<SidecarStatus>(
                    '/connect',
                    {
                        method: 'POST',
                        body: JSON.stringify({ roaster: roasterKey, ...params }),
                    },
                    CONNECT_TIMEOUT_MS,
                    false,
                ),
            CONNECT_RETRY_BUDGET_MS,
        ),

    // connect와 같은 예산을 준다 — 진행 중인 핸드셰이크를 취소하고 정리가 끝나기를
    // 기다려야 하므로, 5s 기본값이면 요청이 먼저 abort돼 상태가 갱신되지 않는다.
    disconnect: () => request<SidecarStatus>('/disconnect', { method: 'POST' }, CONNECT_TIMEOUT_MS),

    getTemperatures: () => request<TemperatureReading>('/temperatures'),

    updateSettings: (settings: Record<string, unknown>) =>
        request<{ ok: boolean }>('/settings', { method: 'POST', body: JSON.stringify(settings) }),

    // READY 버튼과 연동 — 가상 머신에 standby 진입 알림 (생두 투입 시뮬레이션 시작)
    enterStandby: () => request<{ ok: boolean }>('/standby', { method: 'POST' }),

    // Charge 버튼과 연동 — 시뮬레이터 타이머 리셋 + RoR 윈도우 초기화
    startRoast: () => request<{ ok: boolean }>('/start', { method: 'POST' }, DEFAULT_TIMEOUT_MS, false),

    // 로스트 종료/리셋 — 어댑터 상태를 초기화해 다음 로스트를 예열 상태에서 시작
    resetRoast: () => request<{ ok: boolean }>('/reset', { method: 'POST' }, DEFAULT_TIMEOUT_MS, false),

    /**
     * 머신 제어값 쓰기. 사이드카가 write_map 범위로 자른 뒤 `applied`로 실제 값을 돌려준다.
     * 409 = 미연결/쓰기 미지원, 400 = 형식 오류.
     */
    setControl: (cmd: Partial<Record<'heater' | 'fan' | 'drum', number>>) =>
        request<{ ok: boolean; applied: Partial<Record<'heater' | 'fan' | 'drum', number>> }>('/control', {
            method: 'POST',
            body: JSON.stringify(cmd),
        }),

    /** PID 제어 시작. sv = 목표 BT(°C). 409 = 미연결/미지원, 400 = 범위 밖 */
    pidOn: (sv: number) =>
        request<{ ok: boolean; pid: PidRuntime }>('/pid/on', {
            method: 'POST',
            body: JSON.stringify({ sv }),
        }),

    /** PID 해제. mode='hold'는 현재 화력 유지, 'zero'는 히터 0. */
    pidOff: (mode: 'hold' | 'zero' = 'hold') =>
        request<{ ok: boolean; pid: PidRuntime }>('/pid/off', {
            method: 'POST',
            body: JSON.stringify({ mode }),
        }),

    pidSetSv: (sv: number) =>
        request<{ ok: boolean; pid: PidRuntime }>('/pid/sv', {
            method: 'POST',
            body: JSON.stringify({ sv }),
        }),

    getSerialPorts: () => request<SerialPort[]>('/serial-ports'),

    /** TCP port probe on LAN /24. protocol: s7 | modbus_tcp | kaleido | probat_ws */
    scanNetwork: (protocol: string) =>
        request<NetworkHost[]>(
            `/scan-network?protocol=${encodeURIComponent(protocol)}`,
            undefined,
            SCAN_NETWORK_TIMEOUT_MS,
        ),
};
