export type ReplayDisableReason =
    | 'mismatch'
    | 'curveError'
    | 'noHeater'
    | 'disconnected'
    | 'unwritable'
    | 'pid'
    | 'unacknowledged';

export type ReplayDisableInput = {
    active: boolean;
    machineMismatch: boolean;
    hasPlan: boolean;
    curveError: boolean;
    sidecarConnected: boolean;
    heaterWritable: boolean;
    pidEngaged: boolean;
    heaterUnacknowledged: boolean;
};

/**
 * 켤 수 없을 때 상시 표시할 사유. hover에 숨기지 않는다 (#372).
 * 우선순위: 프로파일(mismatch/곡선/기록) → 연결·쓰기 → 소유권(PID/unack).
 * TSV 로드 실패 자체는 #347. 여기선 isError 카피만 접지 않는다.
 */
export const resolveReplayDisableReason = (s: ReplayDisableInput): ReplayDisableReason | null => {
    if (s.active) return null;
    if (s.machineMismatch) return 'mismatch';
    if (!s.hasPlan) return s.curveError ? 'curveError' : 'noHeater';
    if (!s.sidecarConnected) return 'disconnected';
    if (!s.heaterWritable) return 'unwritable';
    if (s.pidEngaged) return 'pid';
    if (s.heaterUnacknowledged) return 'unacknowledged';
    return null;
};

export const isGiesenRoasterKey = (roasterKey: string | null | undefined): boolean =>
    typeof roasterKey === 'string' && roasterKey.startsWith('giesen_');

/** 접힌 레일 Replay 점 — PID emerald와 구분. finished는 점 없음. */
export const collapsedReplayTone = (active: boolean, stopReason: string | null): 'active' | 'stopped' | null => {
    if (active) return 'active';
    if (stopReason && stopReason !== 'finished') return 'stopped';
    return null;
};
