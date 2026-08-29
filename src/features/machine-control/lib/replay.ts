/**
 * Replay Assist (#300) — 레퍼런스 배치의 heater 조작 기록을 이번 배치에서 재생한다.
 *
 * Cropster Replay와 같은 원리: 시간축 재생이 아니라 **레퍼런스 BT 도달 트리거**의
 * 오픈루프다. 이번 배치가 레퍼런스보다 느리면 가스 변경도 그만큼 늦게 들어간다.
 *
 * 단 차지 직후에는 BT가 하강했다가 TP(turning point)를 찍고 올라오므로, 같은 BT를
 * 배치당 두 번 지난다. 레벨 비교(≥)만 쓰면 하강 중에 후반 이벤트가 오발된다 —
 * 그래서 레퍼런스 TP 이전 이벤트는 시간축으로, 이후 이벤트는 "실기 TP 확정 후 +
 * BT 도달"로 판정한다 (Artisan의 TP 이전 시간 폴백과 동일).
 */

export interface ReplayPoint {
    /** charge 기준 상대 시간(초). 음수 = pre-charge */
    t: number;
    bt: number;
    heater: number | null;
}

export interface ReplayEvent {
    t: number;
    bt: number;
    heater: number;
}

export interface ReplayPlan {
    events: ReplayEvent[];
    /** 레퍼런스 커브의 TP 시각 — 이 시각 이전 이벤트는 시간축으로 재생한다 */
    tpTime: number;
}

/**
 * 이 폭 미만의 변화는 이벤트로 치지 않는다 — 사람 조작은 보통 5% 단위,
 * 미세한 흔들림은 센서/PID 노이즈다.
 */
const MIN_HEATER_DELTA = 1;

/**
 * 이벤트가 이보다 많으면 PID가 기록한 배치로 판정하고 재생을 거부한다.
 * PID는 duty를 매 tick 미세 조정하므로 델타 필터로는 못 거른다 — 그런 기록을
 * 수백 번 따라 쓰는 것은 재생이 아니라 열화된 PID다. 필요하면 PID를 켜는 게 맞다.
 *
 * 실기록 기준: 20분+ 배치에서 1%씩 내리는 조작이 35회까지 관측됨(초기값 포함 36이벤트).
 * PID 기록은 폴링마다 흔들려 수백 이벤트라 60으로도 충분히 갈린다.
 */
const MAX_EVENTS = 60;

/**
 * running min 대비 이만큼 BT가 회복해야 TP로 확정한다 — 센서 흔들림이
 * 하강 중의 가짜 전환점을 TP로 잡는 것을 막는 히스테리시스.
 */
const TP_RISE_MARGIN = 2;

/**
 * 레퍼런스 커브에서 재생 계획을 뽑는다. heater 기록이 없거나(합성 프로파일),
 * 이벤트가 비정상적으로 많으면(PID 기록) null — Replay 부적합.
 *
 * 이벤트는 heater 값이 직전 이벤트 대비 MIN_HEATER_DELTA 이상 바뀐 지점만.
 * 첫 non-null heater는 초기 화력으로 항상 포함한다 (t=0이면 charge 직후 발화).
 *
 * dropTime(레퍼런스의 charge→drop 초) 이후 포인트는 버린다 — 레코더는 배출 후에도
 * 기록을 계속하므로 쿨다운 중 슬라이더 조작이 TSV에 남고, 그 BT 구간(하강 꼬리)은
 * 이번 배치의 발전 구간과 겹쳐 배출 후 조작이 로스팅 한복판에 발화한다
 * (Artisan도 DROP 이후 이벤트는 재생하지 않는다).
 */
export const extractReplayEvents = (points: ReplayPoint[], dropTime?: number | null): ReplayPlan | null => {
    const cutoff = dropTime ?? Number.POSITIVE_INFINITY;
    const post = points.filter((p) => p.t >= 0 && p.t <= cutoff);
    if (post.length === 0) return null;

    const events: ReplayEvent[] = [];
    let lastHeater: number | null = null;
    for (const p of post) {
        if (p.heater == null) continue;
        if (lastHeater == null || Math.abs(p.heater - lastHeater) >= MIN_HEATER_DELTA) {
            events.push({ t: p.t, bt: p.bt, heater: p.heater });
            lastHeater = p.heater;
            if (events.length > MAX_EVENTS) return null;
        }
    }
    if (events.length === 0) return null;

    // TP는 첫 하강→상승 전환점: running min을 추적하다 BT가 마진 이상 회복하는
    // 순간 그 min 지점으로 확정한다. 전역 최솟값은 쿨다운 꼬리(phase는 endRoast까지
    // 'roasting'이라 TSV에 남는다)에 오염되고, "피크 이전 최솟값"(ff9dbb0)은 charge가
    // 전 구간 최대인 커브(#310)에서 탐색 구간이 charge로 붕괴한다 — 둘 다 안 된다.
    // 회복이 끝까지 없으면(단조 하강 초단기 세션) Infinity → 전 이벤트 시간축 재생.
    // 시간축은 오발이 불가능한 안전한 퇴화 케이스다.
    let tpTime = Number.POSITIVE_INFINITY;
    let min = 0;
    for (let i = 1; i < post.length; i++) {
        if (post[i].bt < post[min].bt) min = i;
        else if (post[i].bt >= post[min].bt + TP_RISE_MARGIN) {
            tpTime = post[min].t;
            break;
        }
    }

    return { events, tpTime };
};

export interface ReplaySample {
    bt: number;
    elapsed: number;
    /** 실기 TP 확정 여부 — 미확정(하강 가능 구간)에는 BT 트리거를 열지 않는다 */
    afterTurningPoint: boolean;
}

/**
 * 이번 샘플에서 발화할 heater 값 판정. 순방향 인덱스라 재발화가 없고,
 * 한 샘플에 여러 이벤트를 넘으면 마지막 값 하나만 쓴다 (중간값 순차 쓰기는 무의미).
 */
export const judgeReplay = (
    plan: ReplayPlan,
    nextIndex: number,
    sample: ReplaySample,
): { nextIndex: number; heater: number | null } => {
    let heater: number | null = null;
    let i = nextIndex;
    while (i < plan.events.length) {
        const e = plan.events[i];
        // TP 시각과 같은 이벤트는 시간 쪽 — BT 골짜기 부근은 값이 평평해 BT 트리거가 불안정하다
        const fires = e.t <= plan.tpTime ? sample.elapsed >= e.t : sample.afterTurningPoint && sample.bt >= e.bt;
        if (!fires) break;
        heater = e.heater;
        i += 1;
    }
    return { nextIndex: i, heater };
};
