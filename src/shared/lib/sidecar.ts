import type {
  RoastersResponse,
  SerialPort,
  SidecarStatus,
  TemperatureReading,
} from '../types/machine';

const BASE = 'http://127.0.0.1:9999';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const sidecar = {
  getRoasters: () =>
    request<RoastersResponse>('/roasters'),

  getStatus: () =>
    request<SidecarStatus>('/status'),

  connect: (roasterKey: string, params: Record<string, unknown>) =>
    request<SidecarStatus>('/connect', {
      method: 'POST',
      body: JSON.stringify({ roaster: roasterKey, ...params }),
    }),

  disconnect: () =>
    request<SidecarStatus>('/disconnect', { method: 'POST' }),

  getTemperatures: () =>
    request<TemperatureReading>('/temperatures'),

  // Charge 버튼과 연동 — 시뮬레이터 타이머 리셋 + RoR 윈도우 초기화
  startRoast: () =>
    request<{ ok: boolean }>('/start', { method: 'POST' }),

  control: (params: { heater?: number; fan?: number; drum?: number }) =>
    request<{ ok: boolean }>('/control', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getSerialPorts: () =>
    request<SerialPort[]>('/serial-ports'),
};
