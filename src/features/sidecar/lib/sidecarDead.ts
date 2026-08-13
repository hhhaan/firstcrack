export type SidecarDeadEvent = 'sidecar-dead' | 'status-healthy' | 'status-failed';

/** Latch dead on the event; clear only when GET /status succeeds. */
export function nextSidecarDeadState(input: { isDead: boolean; event: SidecarDeadEvent }): boolean {
    if (input.event === 'sidecar-dead') return true;
    if (input.event === 'status-healthy') return false;
    return input.isDead;
}

/** Sidecar process is up if /status resolved — machine connected is unrelated. */
export function isSidecarProcessHealthy(status: unknown): boolean {
    return status != null && typeof status === 'object';
}
