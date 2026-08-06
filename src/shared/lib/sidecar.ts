import type { NetworkHost, SerialPort, SidecarStatus, TemperatureReading } from '@entities/machine';
import { invoke } from '@tauri-apps/api/core';
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

async function request<T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    try {
        const token = await getSidecarToken();
        const res = await fetch(`${SIDECAR_BASE}${path}`, {
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
            logger.error(`[sidecar] ${init?.method ?? 'GET'} ${path} 실패:`, msg);
            throw new Error(msg);
        }
        return await (res.json() as Promise<T>);
    } catch (err) {
        if (!(err instanceof Error && err.message.startsWith('HTTP'))) {
            logger.error(`[sidecar] ${path} 네트워크 오류:`, err);
        }
        throw err;
    }
}

export const sidecar = {
    getStatus: () => request<SidecarStatus>('/status'),

    connect: (roasterKey: string, params: Record<string, unknown>) =>
        request<SidecarStatus>(
            '/connect',
            {
                method: 'POST',
                body: JSON.stringify({ roaster: roasterKey, ...params }),
            },
            CONNECT_TIMEOUT_MS,
        ),

    disconnect: () => request<SidecarStatus>('/disconnect', { method: 'POST' }),

    getTemperatures: () => request<TemperatureReading>('/temperatures'),

    updateSettings: (settings: Record<string, unknown>) =>
        request<{ ok: boolean }>('/settings', { method: 'POST', body: JSON.stringify(settings) }),

    // READY 버튼과 연동 — 가상 머신에 standby 진입 알림 (생두 투입 시뮬레이션 시작)
    enterStandby: () => request<{ ok: boolean }>('/standby', { method: 'POST' }),

    // Charge 버튼과 연동 — 시뮬레이터 타이머 리셋 + RoR 윈도우 초기화
    startRoast: () => request<{ ok: boolean }>('/start', { method: 'POST' }),

    // 로스트 종료/리셋 — 어댑터 상태를 초기화해 다음 로스트를 예열 상태에서 시작
    resetRoast: () => request<{ ok: boolean }>('/reset', { method: 'POST' }),

    /**
     * 머신 제어값 쓰기. 사이드카가 write_map 범위로 자른 뒤 `applied`로 실제 값을 돌려준다.
     * 409 = 미연결/쓰기 미지원, 400 = 형식 오류.
     */
    setControl: (cmd: Partial<Record<'heater' | 'fan' | 'drum', number>>) =>
        request<{ ok: boolean; applied: Partial<Record<'heater' | 'fan' | 'drum', number>> }>('/control', {
            method: 'POST',
            body: JSON.stringify(cmd),
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
