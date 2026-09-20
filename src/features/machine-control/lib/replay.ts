/**
 * Replay Assist (#300) — 레퍼런스 배치의 **Heat set 지시**를 이번 배치에서 재생한다.
 *
 * Replay = 앱에 기록된 화력 지시 재현. 실측 Heat(`heater`)로 대체하지 않는다 (#529).
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
    /** 기기 실측. Replay 추출에 쓰지 않는다. TsvPoint 호환용 */
    heater?: number | null;
    /** 앱이 쓴 화력 지시(TSV 8열). Replay 원본 */
    heaterSet?: number | null;
}

/** 행별 발화 기준. TSV 추출은 TP 이전·동일 시각=time, 이후=bt. */
export type ReplayTrigger = 'time' | 'bt';

export interface ReplayEvent {
    t: number;
    bt: number;
    heater: number;
}

/** judgeReplay와 표시가 같은 분류를 쓴다. UI에서 TP 판정을 복제하지 않는다. */
export const eventTrigger = (event: ReplayEvent, tpTime: number): ReplayTrigger => (event.t <= tpTime ? 'time' : 'bt');

export interface ReplayPlan {
    events: ReplayEvent[];
    /** 레퍼런스 커브의 TP 시각 — 이 시각 이전 이벤트는 시간축으로 재생한다 */
    tpTime: number;
}

/** 추출에 쓰는 지시값. 실측 `heater`는 보지 않는다. 0은 결측이 아니다. */
export const replayCommand = (p: ReplayPoint): number | null => {
    const v = p.heaterSet;
    if (v == null || !Number.isFinite(v) || v < 0) return null;
    return v;
};

/**
 * Charge 이후·Drop 이전에 지시 샘플이 하나라도 있는가.
 * 재생 계획 유효성(양수 이벤트·PID 폭증)과 별개 — 기록 없음 UI에 쓴다.
 */
export const hasHeatSetRecord = (points: ReplayPoint[] | null | undefined, dropTime?: number | null): boolean => {
    if (points == null || points.length === 0) return false;
    const cutoff = dropTime ?? Number.POSITIVE_INFINITY;
    return points.some((p) => p.t >= 0 && p.t < cutoff && replayCommand(p) != null);
};

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
 * 이 시각 이전에는 TP를 확정하지 않는다 — 실기 감지기(detectTurningPoints)·Artisan과 같은 floor.
 * charge 직후의 프로브 범프(+2°)가 TP로 잡히면 하강 구간의 가스 조작 전부가 BT축으로 밀려
 * 실기 TP 이후에야(수 분 늦게) 발화한다.
 */
const TP_MIN_ELAPSED_S = 20;

/**
 * 레퍼런스 커브에서 재생 계획을 뽑는다. Heat set 지시가 없거나(구 TSV·합성 프로파일),
 * 이벤트가 비정상적으로 많으면(PID 기록) null — Replay 부적합.
 *
 * 이벤트는 heaterSet이 직전 이벤트와 달라진 지점만.
 * 첫 유효 지시는 초기 화력으로 항상 포함한다 (t=0이면 charge 직후 발화).
 * 첫 지시 전 null은 허용하지만 이후 null은 기록 손실이므로 계획 전체를 거부한다.
 * 실측으로 채우거나 보간하지 않는다.
 *
 * 음수 heaterSet은 결측으로 본다. 0은 유효 지시(가스 컷). 양수가 한 번도 없는
 * 기록은 null — 그대로 재생하면 charge에서 버너를 꺼 버린다. 로스팅 중 0으로
 * 내리는 조작은 양수 이벤트가 앞에 있으므로 살아남는다.
 *
 * dropTime(레퍼런스의 charge→drop 초) 이후 포인트는 버린다 — 레코더는 배출 후에도
 * 기록을 계속하므로 쿨다운 중 슬라이더 조작이 TSV에 남고, 그 BT 구간(하강 꼬리)은
 * 이번 배치의 발전 구간과 겹쳐 배출 후 조작이 로스팅 한복판에 발화한다
 * (Artisan도 DROP 이후 이벤트는 재생하지 않는다).
 */
export const extractReplayEvents = (points: ReplayPoint[], dropTime?: number | null): ReplayPlan | null => {
    if (dropTime != null && !Number.isFinite(dropTime)) return null;
    const cutoff = dropTime ?? Number.POSITIVE_INFINITY;
    if (points.some((p) => !Number.isFinite(p.t) || !Number.isFinite(p.bt))) return null;
    const post = points.filter((p) => p.t >= 0 && p.t < cutoff);
    if (post.length === 0) return null;

    const events: ReplayEvent[] = [];
    let lastHeater: number | null = null;
    for (const p of post) {
        const cmd = replayCommand(p);
        if (cmd == null) {
            if (lastHeater != null) return null;
            continue;
        }
        if (lastHeater == null || cmd !== lastHeater) {
            events.push({ t: p.t, bt: p.bt, heater: cmd });
            lastHeater = cmd;
            if (events.length > MAX_EVENTS) return null;
        }
    }
    if (!events.some((e) => e.heater > 0)) return null;

    // TP는 첫 하강→상승 전환점: running min을 추적하다 BT가 마진 이상 회복하는
    // 순간 그 min 지점으로 확정한다. 전역 최솟값은 쿨다운 꼬리(phase는 endRoast까지
    // 'roasting'이라 TSV에 남는다)에 오염되고, "피크 이전 최솟값"(ff9dbb0)은 charge가
    // 전 구간 최대인 커브(#310)에서 탐색 구간이 charge로 붕괴한다 — 둘 다 안 된다.
    // 회복이 끝까지 없으면(단조 하강 초단기 세션) Infinity → 전 이벤트 시간축 재생.
    // 시간축은 오발이 불가능한 안전한 퇴화 케이스다.
    // floor는 골짜기 후보 자체에 건다 — 회복 샘플에만 걸면 t<20의 글리치 골짜기가
    // 20초 이후 첫 샘플의 회복으로 그대로 확정된다.
    let tpTime = Number.POSITIVE_INFINITY;
    let min = -1;
    for (let i = 0; i < post.length; i++) {
        if (post[i].t < TP_MIN_ELAPSED_S) continue;
        if (min < 0 || post[i].bt < post[min].bt) min = i;
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
        const fires =
            eventTrigger(e, plan.tpTime) === 'time'
                ? sample.elapsed >= e.t
                : sample.afterTurningPoint && sample.bt >= e.bt;
        if (!fires) break;
        heater = e.heater;
        i += 1;
    }
    return { nextIndex: i, heater };
};
