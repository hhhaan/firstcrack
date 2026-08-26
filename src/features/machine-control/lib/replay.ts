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
 */
const MAX_EVENTS = 30;

/**
 * 레퍼런스 커브에서 재생 계획을 뽑는다. heater 기록이 없거나(합성 프로파일),
 * 이벤트가 비정상적으로 많으면(PID 기록) null — Replay 부적합.
 *
 * 이벤트는 heater 값이 직전 이벤트 대비 MIN_HEATER_DELTA 이상 바뀐 지점만.
 * 첫 non-null heater는 초기 화력으로 항상 포함한다 (t=0이면 charge 직후 발화).
 */
export const extractReplayEvents = (points: ReplayPoint[]): ReplayPlan | null => {
    const post = points.filter((p) => p.t >= 0);
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

    // TP는 BT 피크(≈drop) 이전 구간의 최솟값 (charge 고온 → 골짜기 → drop 피크).
    // 전역 최솟값을 쓰면 배출 후에도 기록된 쿨다운 꼬리(phase는 endRoast까지
    // 'roasting'이라 TSV에 남는다)가 TP를 말미로 밀어 전 이벤트가 시간축 재생으로
    // 강등된다 — 피크 이전으로 한정하면 꼬리가 아무리 식어도 영향이 없다.
    let peak = 0;
    for (let i = 1; i < post.length; i++) if (post[i].bt > post[peak].bt) peak = i;
    let tp = post[0];
    for (let i = 1; i <= peak; i++) if (post[i].bt < tp.bt) tp = post[i];

    return { events, tpTime: tp.t };
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
