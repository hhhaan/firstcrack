/** 호스트 poll clock의 tick 주기 (src-tauri/src/poll_clock.rs INTERVAL_MS와 동일). */
export const HOST_TICK_MS = 500;

/**
 * 호스트 `sidecar-poll-tick` 수락 게이트.
 * IPC 전달 지터로 tick 간격이 pollIntervalMs보다 살짝 짧게 도착해도 skip하지
 * 않도록 반 tick 마진을 둔다 — 마진 없이는 경계 skip 한 번에 폴링 주기가
 * +500ms 늘어난다 (500ms 설정 시 실효 주기 ~750ms–1s).
 */
export const shouldAcceptTick = (nowMs: number, lastAcceptedMs: number, pollIntervalMs: number): boolean =>
    nowMs - lastAcceptedMs >= pollIntervalMs - HOST_TICK_MS / 2;
