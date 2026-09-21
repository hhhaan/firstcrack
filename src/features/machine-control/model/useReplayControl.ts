import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { divergeTolerance } from '../lib/controlScale';
import type { ControlOrigin } from '../lib/controlSender';
import { carryReplayEventIds, remapReplayIndex, resolveReplayPlan } from '../lib/heater-events';
import {
    eventTrigger,
    extractReplayEvents,
    hasHeatSetRecord,
    judgeReplay,
    type ReplayEvent,
    type ReplayPoint,
} from '../lib/replay';

/** Matches R04 `ObservationQuality`. Duplicated so this slice does not import another feature. */
export type ObservationQuality = 'valid' | 'stale' | 'retransmit' | 'null' | 'spike' | 'poll_error' | 'reconnecting';

export { divergeTolerance };

export interface ReplayControlInputs {
    /** 타겟 프로파일 커브 (charge 기준 상대 시간) — 없으면 Replay 비활성 */
    referencePoints: ReplayPoint[] | null;
    /**
     * 레퍼런스가 다른 기종에서 기록됐다 — Replay는 같은 기기만 재생한다. 히터 스케일이
     * 다르면(WxA coarse 0~10 스텝 vs % 기종) 전 이벤트가 clamp로 최대/최소 화력에 붙는다.
     * 양쪽 키가 모두 있고 다를 때만 true — 마이그레이션 이전 프로파일(null)은 막지 않는다.
     */
    referenceMachineMismatch: boolean;
    /** 레퍼런스의 charge→drop 초 — 배출 후 기록(쿨다운 조작)을 재생에서 제외한다 */
    referenceDropTime: number | null;
    /** 프로파일 heater_events jsonb — null이면 TSV 추출 (#435) */
    profileHeaterEvents?: unknown;
    liveBt: number | null;
    elapsed: number;
    /** phase === 'roasting' — 이 밖에서는 판정도 쓰기도 하지 않는다 */
    roasting: boolean;
    /**
     * 실기 TP 사실 — 게이트와 대기 UI를 여기서 파생한다. fallback은 BT를 열지 않는다 (#314).
     * 뷰에 tpWaiting boolean을 두지 않는다.
     */
    confirmedTurningPoint: { fallback?: boolean } | null;
    heaterWritable: boolean;
    /** PID가 off가 아니면 Replay 불가 — 히터 소유권은 하나 */
    pidEngaged: boolean;
    roastFinished: boolean;
    sidecarConnected: boolean;
    /** 지시했는데 기기가 안 따라온 상태 — 재생을 계속 밀어붙이지 않는다 (#269) */
    heaterUnacknowledged: boolean;
    /**
     * 배출 시 화력 정책 — pidDropBehavior 공용 (#316). PID든 Replay든 "DROP 후
     * 화력을 어떻게 둘지"는 한 정책이다. zero면 배출 즉시 heater 0을 쓴다(PID
     * off와 같은 타이밍 — 유예를 두면 Drop 취소·End 확정과 얽혀 오발/누락이 생긴다).
     * hold면 마지막 재생 값을 남긴다 — 설정으로 선택된, 문서화된 잔류다.
     */
    dropBehavior: 'hold' | 'zero';
    /** heater 실측 — Replay 마지막 확정 명령과의 지속 이탈 감지용 (#307) */
    heaterFeedback: number | null;
    /** heater 지시가 아직 수렴하지 않았다(desired 잔존) — settling 동안은 이탈 판정 제외 */
    heaterPending: boolean;
    /**
     * 사이드카 재연결 대기 중 — 이 동안 실측은 동결되는데 elapsed는 호스트 시계라
     * 계속 흘러, 같은 샘플 하나로 "지속 이탈"을 확정할 수 있다. 카운트를 멈춘다.
     */
    reconnecting: boolean;
    /**
     * R04 collection-boundary quality. Ordinary TIME/BT writes run only on `'valid'`.
     * Required: `null` means this generation has no observation yet (hold).
     * Do not omit the field for test convenience — pass `'valid'` when a write is expected.
     */
    observationQuality: ObservationQuality | null;
    /**
     * Last-valid observation wall-clock. Explicit `null` = this generation has no last-valid (hold).
     * Omit to skip the proposed long-gap stop in tests.
     */
    lastValidReceivedAtMs?: number | null;
    /** Wall-clock for last-valid age. Omit with lastValid to skip long-gap stop in tests. */
    nowMs?: number | null;
    /** resolve number = 기기에 남은 세트포인트, null = /control 실패 — Replay는 실패 이벤트를 소진하지 않는다 (#312, #376) */
    writeHeater: (value: number, origin?: ControlOrigin) => Promise<number | null>;
    /**
     * 미전송 Replay heater만 선택 취소. fan/drum·수동 commit·DROP zero(safety)는 남긴다.
     */
    cancelUnsentHeater: () => void;
    /**
     * heater write_map.max — `/status.control.limits.heater.max`. 수렴·이탈
     * 허용치를 같이 유도한다. 없으면 0~100% 전제(기존 수렴 1 / 이탈 2).
     */
    heaterMax?: number | null;
    heaterMin?: number | null;
    /** Device write_map step when the sidecar actually has one. Never a UI percent snap. */
    heaterStep?: number | null;
}

/** 재생 중지 사유 — 'finished'는 배치 종료라 UI에 표시하지 않는다 */
export type ReplayStopReason =
    | 'disconnected'
    | 'pid'
    | 'unacknowledged'
    | 'unwritable'
    | 'finished'
    | 'manual'
    | 'profileChanged'
    | 'controlDiverged'
    | 'timingGap'
    | 'writeFailed'
    /** Last-valid observation older than the proposed R06 limit. Not a shipping-approved safety rating. */
    | 'observationStale';

const replayStopCause = ({
    sidecarConnected,
    pidEngaged,
    heaterUnacknowledged,
    heaterWritable,
    roastFinished,
}: {
    sidecarConnected: boolean;
    pidEngaged: boolean;
    heaterUnacknowledged: boolean;
    heaterWritable: boolean;
    roastFinished: boolean;
}): ReplayStopReason | null => {
    if (!sidecarConnected) return 'disconnected';
    if (pidEngaged) return 'pid';
    if (heaterUnacknowledged) return 'unacknowledged';
    if (!heaterWritable) return 'unwritable';
    if (roastFinished) return 'finished';
    return null;
};

/** 이탈이 이만큼의 elapsed 틱(≈1초) 연속이어야 확정 — 순간 스파이크 제외 */
const DIVERGE_TICKS = 3;
/**
 * 연속 렌더 사이 elapsed가 이만큼 **초과** 뛰면 JS가 멈췄던 것으로 본다 (#313).
 * elapsed는 호스트 시계에서 유도되지만 갱신은 webview 타이머·폴링이 하므로, 창
 * 최소화·App Nap·슬립으로 webview가 스로틀되면 멈췄다가 복귀 때 한 번에 점프한다.
 * 그동안 실기는 마지막 화력으로 계속 돌았고 UI만 Replay On이었다 — fail-closed로
 * 멈추고 사람이 확인 후 다시 켠다. 정상 틱은 1초(지터 2초), 최대 폴링 주기 1초.
 * ponytail: sidecar heartbeat로 판정을 옮기면(#308) 이 감지는 그쪽 책임이 된다.
 */
const SAMPLE_GAP_LIMIT_S = 5;
/**
 * Proposed long-gap policy: last-valid observation age above this stops Replay.
 * Not equipment-validated and not a shipping-approved safety limit — under review (#529).
 */
export const PROPOSED_OBSERVATION_STALE_LIMIT_MS = 5_000;

/**
 * Replay Assist 수명 관리 (#300). 판정은 lib/replay의 순수 함수가 하고,
 * 이 훅은 켜기/끄기와 안전 중지만 담당한다.
 *
 * 기본 OFF, 명시적 토글로만 시작. 시작·재개 시 현재 시간·BT로 처음부터 판정해
 * 마지막으로 충족한 화력 하나를 적용하고, 이후 이벤트부터 이어간다.
 */
export const useReplayControl = ({
    referencePoints,
    referenceMachineMismatch,
    referenceDropTime,
    profileHeaterEvents,
    liveBt,
    elapsed,
    roasting,
    confirmedTurningPoint,
    heaterWritable,
    pidEngaged,
    roastFinished,
    sidecarConnected,
    heaterUnacknowledged,
    dropBehavior,
    heaterFeedback,
    heaterPending,
    reconnecting,
    observationQuality,
    lastValidReceivedAtMs,
    nowMs,
    writeHeater,
    cancelUnsentHeater,
    heaterMax,
    heaterMin,
    heaterStep,
}: ReplayControlInputs) => {
    const hasHeatSet = useMemo(
        () => hasHeatSetRecord(referencePoints, referenceDropTime),
        [referencePoints, referenceDropTime],
    );
    const minHeater = heaterMin ?? 0;
    const maxHeater = heaterMax ?? 100;
    // null points = 로딩. 이전 프로파일 계획을 새 프로파일에 쓰지 않는다.
    const extracted = useMemo(
        () => (referencePoints ? extractReplayEvents(referencePoints, referenceDropTime) : null),
        [referencePoints, referenceDropTime],
    );
    const [batchEvents, setBatchEvents] = useState<ReplayEvent[] | null>(null);
    const [prevExtracted, setPrevExtracted] = useState(extracted);
    const [prevProfileEvents, setPrevProfileEvents] = useState(profileHeaterEvents);
    const sourceChanged = extracted !== prevExtracted || profileHeaterEvents !== prevProfileEvents;
    if (sourceChanged) {
        setPrevExtracted(extracted);
        setPrevProfileEvents(profileHeaterEvents);
        if (batchEvents != null) setBatchEvents(null);
    }
    const {
        plan: resolvedPlan,
        source: planSource,
        overrideInvalid,
    } = useMemo(
        () =>
            resolveReplayPlan({
                points: referencePoints,
                dropTime: referenceDropTime,
                profileEvents: profileHeaterEvents,
                batchEvents: sourceChanged ? null : batchEvents,
                heaterMin: minHeater,
                heaterMax: maxHeater,
                heaterStep: heaterStep ?? undefined,
            }),
        [
            referencePoints,
            referenceDropTime,
            profileHeaterEvents,
            batchEvents,
            sourceChanged,
            minHeater,
            maxHeater,
            heaterStep,
        ],
    );
    const rawPlan = overrideInvalid ? null : resolvedPlan;
    const rawEvents = rawPlan?.events ?? null;

    // 안전 중지 — 조건이 하나라도 성립하는 동안 active로 남아 있으면 안 된다
    const stopCause = replayStopCause({
        sidecarConnected,
        pidEngaged,
        heaterUnacknowledged,
        heaterWritable,
        roastFinished,
    });

    const [active, setActive] = useState(false);
    const [index, setIndex] = useState(0);
    /** 마지막 자동/수동 중지 사유 — 토글 재시작 전까지 UI에 지속 표시 */
    const [stopReason, setStopReason] = useState<ReplayStopReason | null>(null);
    /** zero 정책의 safe-off write가 나갔다 — 기기가 따라올 때까지 재시도 대상 (#316) */
    const [safeOffIssued, setSafeOffIssued] = useState(false);
    /**
     * Replay가 마지막으로 쓴 화력 — 수렴 후 실측과의 비교 기준 (#307). 이탈의 원인
     * (사람 조작반·본체 Auto·안전 인터락·타 소프트웨어)은 구분할 수 없고 하지도
     * 않는다 — 대응이 모두 "재생 중지"로 같다.
     */
    const [lastWritten, setLastWritten] = useState<number | null>(null);
    const [diverge, setDiverge] = useState({ tick: elapsed, ticks: 0 });
    /** 직전 렌더의 elapsed — 타이밍 갭 감지 기준 (#313) */
    const [prevElapsed, setPrevElapsed] = useState(elapsed);
    /**
     * Previously accepted last-valid wall-clock for R06 age. A recovery sample that
     * refreshes last-valid first is still a gap against this, not against the new stamp.
     */
    const [trustedLastValidMs, setTrustedLastValidMs] = useState<number | null>(null);
    /**
     * 이벤트 write가 /control 응답 대기 중 — 그동안 판정을 멈춰 같은 이벤트를 두 번 쓰지
     * 않는다 (#312). 응답 세대: 배치·프로파일 경계뿐 아니라 사용자 OFF·수동/PID 중단·재시작
     * 뒤에 도착한 늦은 성공/실패는 무시한다. 옛 응답이 index·lastWritten·stop reason을
     * 덮거나 새 요청의 writing을 풀면 안 된다 (#368 R02).
     */
    const [writing, setWriting] = useState(false);
    const writeGenRef = useRef(0);
    const [safeOffNonce, setSafeOffNonce] = useState(0);
    const [pendingWrite, setPendingWrite] = useState<{
        heater: number;
        nextIndex: number;
        oldEvents: ReplayEvent[];
        id?: string;
    } | null>(null);
    const [labeledEvents, setLabeledEvents] = useState<ReplayEvent[] | null>(null);
    const [prevRawEvents, setPrevRawEvents] = useState<ReplayEvent[] | null>(null);
    const labeledEventsRef = useRef<ReplayEvent[] | null>(null);
    // #314: fallback TP는 곡선에서 관측된 상승이 아니라 BT 게이트를 열 수 없다
    const afterTurningPoint = confirmedTurningPoint != null && !confirmedTurningPoint.fallback;

    const invalidateInFlightWrite = useCallback(() => {
        writeGenRef.current += 1;
        // 세대만 올리면 늦은 응답은 무시되지만, sender에 남은 Replay heater는 그대로 나간다 (#368 R03).
        cancelUnsentHeater();
        setPendingWrite(null);
        setWriting(false);
    }, [cancelUnsentHeater]);

    /** 렌더 중 확정된 중단 — 단조 증가만, StrictMode 이중 호출은 fail-closed.
     * 큐 취소도 여기서: effect까지 미루면 in-flight 슬롯이 비며 Replay heater가 먼저 나간다. */
    const bumpWriteGenOnRenderStop = () => {
        writeGenRef.current += 1;
        cancelUnsentHeater();
        if (pendingWrite != null) setPendingWrite(null);
    };

    // Hold cancels queued Replay writes too; an already-sent response cannot consume the held event.
    if (active && writing && (observationQuality !== 'valid' || reconnecting)) {
        // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
        bumpWriteGenOnRenderStop();
        setWriting(false);
    }

    // PID 등은 렌더에서 stopCause가 먼저 보인다. effect가 세대를 올리기 전에 도착한
    // 응답이 index·사유를 덮지 않게 이 커밋에서 무효화한다.
    const stoppingForCause = active && stopCause != null;
    if (stoppingForCause) {
        // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
        bumpWriteGenOnRenderStop();
        if (writing) setWriting(false);
        setActive(false);
        setStopReason(stopCause);
        if (roastFinished && dropBehavior === 'zero') setSafeOffNonce((n) => n + 1);
    }

    // 레퍼런스/프로파일 오버라이드가 바뀌면 진행 중인 재생은 무효.
    // 배치 편집은 ACK된 행만 소비로 보고, 행 id로 이어간다(가변 t/heater가 식별자가 아님).
    if (sourceChanged) {
        setIndex(0);
        setWriting(false);
        const nextLabeled = rawEvents ? carryReplayEventIds(rawEvents, null) : null;
        setLabeledEvents(nextLabeled);
        setPrevRawEvents(rawEvents);
        // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
        bumpWriteGenOnRenderStop();
        if (active) {
            setActive(false);
            setStopReason('profileChanged');
        }
    } else if (rawEvents !== prevRawEvents) {
        const nextLabeled = rawEvents ? carryReplayEventIds(rawEvents, labeledEvents) : null;
        const acked = index;
        const inFlight = nextLabeled?.[index];
        const sameInFlightRow = inFlight != null && (pendingWrite?.id == null || inFlight.id === pendingWrite.id);
        // Catch-up writes the last eligible heater; that is not events[index].heater.
        const catchup = pendingWrite != null && pendingWrite.nextIndex > acked + 1;
        const stillWriting =
            writing && pendingWrite != null && sameInFlightRow && (catchup || inFlight.heater === pendingWrite.heater);
        if (writing && !stillWriting) {
            // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
            bumpWriteGenOnRenderStop();
            setWriting(false);
        }
        if (labeledEvents && nextLabeled) {
            setIndex(remapReplayIndex(labeledEvents, acked, nextLabeled));
        } else {
            const len = nextLabeled?.length ?? 0;
            if (index > len) setIndex(len);
        }
        setLabeledEvents(nextLabeled);
        setPrevRawEvents(rawEvents);
    }
    const plan = useMemo(
        () => (rawPlan && labeledEvents ? { events: labeledEvents, tpTime: rawPlan.tpTime } : rawPlan),
        [rawPlan, labeledEvents],
    );

    // 배치 경계(roasting 양쪽 에지)에서 인덱스를 되돌린다 — 남은 인덱스는 이전 배치
    // 것이라, 상승 에지만 리셋하면 차지 전(standby/preheat)에 토글을 켰을 때 stale
    // 인덱스가 "모든 이벤트 재생 완료"로 새어나온다. 이전 배치의 중지 사유도 함께
    // 지운다 — 새 배치 패널에 지난 'pid'/'manual' 안내가 남으면 안 된다.
    // reconnect 중에는 phase가 유지되므로(#233) 순간 끊김으로는 오리셋되지 않는다.
    const [prevRoasting, setPrevRoasting] = useState(roasting);
    if (roasting !== prevRoasting) {
        setPrevRoasting(roasting);
        setIndex(0);
        setStopReason(null);
        setLastWritten(null);
        setDiverge({ tick: elapsed, ticks: 0 });
        // lookback 자동 차지는 origin을 과거로 잡아 elapsed가 0보다 크게 시작한다 —
        // 이전 배치 기준으로 재면 차지 직후 오중지된다.
        setPrevElapsed(elapsed);
        setWriting(false);
        // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
        bumpWriteGenOnRenderStop();
        // 이번 배치 편집본은 배치가 끝나면 버린다. Charge(false→true)에서는 유지.
        if (prevRoasting && !roasting) setBatchEvents(null);
    }

    useEffect(() => {
        labeledEventsRef.current = labeledEvents;
    }, [labeledEvents]);

    // 타이밍 갭 판정 (#313) — 렌더 중인 이유는 profileChanged와 같다: 복귀 커밋에서
    // 아래 판정 effect가 stale active로 밀린 이벤트를 한 번 더 쓰는 것을 막는다.
    // 복귀 후 catch-up write는 하지 않는다 — 그동안의 실기 상태를 모른다.
    let replayRunning = active;
    if (elapsed !== prevElapsed) {
        setPrevElapsed(elapsed);
        if (replayRunning && roasting && stopCause == null && elapsed - prevElapsed > SAMPLE_GAP_LIMIT_S) {
            // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
            bumpWriteGenOnRenderStop();
            setWriting(false);
            replayRunning = false;
            setActive(false);
            setStopReason('timingGap');
        }
    }

    // R06 last-valid age — proposed >5s, not equipment-validated.
    // Elapsed ticks must check even with no new sample. A recovery sample that
    // refreshes last-valid first is still a gap against trustedLastValidMs.
    // stopCause가 있으면 렌더 중 중지하지 않는다 — DROP zero effect가 active를 봐야 한다.
    // Explicit null last-valid is this generation's unknown: hold, do not age against
    // a prior generation, do not invent trust from nowMs.
    if (!roasting && trustedLastValidMs !== (lastValidReceivedAtMs ?? null)) {
        setTrustedLastValidMs(lastValidReceivedAtMs ?? null);
    }
    if (replayRunning && roasting && stopCause == null && lastValidReceivedAtMs !== undefined && nowMs != null) {
        if (lastValidReceivedAtMs === null) {
            if (trustedLastValidMs != null) setTrustedLastValidMs(null);
        } else {
            let trusted = trustedLastValidMs;
            if (trusted == null) {
                trusted = lastValidReceivedAtMs;
                setTrustedLastValidMs(trusted);
            }
            const recoveryGap = lastValidReceivedAtMs > trusted ? lastValidReceivedAtMs - trusted : 0;
            const clockGap = nowMs - trusted;
            if (Math.max(recoveryGap, clockGap) > PROPOSED_OBSERVATION_STALE_LIMIT_MS) {
                // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
                bumpWriteGenOnRenderStop();
                setWriting(false);
                replayRunning = false;
                setActive(false);
                setStopReason('observationStale');
            } else if (lastValidReceivedAtMs !== trustedLastValidMs) {
                setTrustedLastValidMs(lastValidReceivedAtMs);
            }
        }
    }

    // 외부 개입 판정 (#307) — elapsed를 틱으로 쓰는 이유: liveData 스토어는 값이 같으면
    // 같은 객체를 유지하므로(디듀프) feedback identity로는 "그대로인 이탈"을 못 센다.
    // effect가 아니라 렌더 중 판정인 이유: 확정 커밋에서 아래 판정 effect가 stale
    // active로 이벤트를 한 번 더 써서 개입을 덮는 것(프로파일 교체와 같은 레이스)을 막는다.
    // write는 절대 하지 않는다 — 이탈 시 존중해야 할 값은 기기에 있는 값이다.
    // reconnecting 동안은 카운트 일시정지(리셋 아님) — 동결된 실측을 elapsed 틱으로
    // 여러 번 세면 1샘플로 확정된다. 복구 후 새 샘플부터 이어 센다.
    if (elapsed !== diverge.tick && !reconnecting) {
        const deviated =
            replayRunning &&
            roasting &&
            !heaterPending &&
            lastWritten != null &&
            heaterFeedback != null &&
            Math.abs(heaterFeedback - lastWritten) > divergeTolerance(heaterMax);
        const ticks = deviated ? diverge.ticks + 1 : 0;
        // 카운터가 0→0이면 setState 생략 — 유휴 중 매초 여분 렌더를 만들지 않는다.
        // tick이 stale해져도 무해하다: 다음 이탈의 첫 렌더에서 1부터 정상 카운트된다.
        if (ticks !== 0 || diverge.ticks !== 0) setDiverge({ tick: elapsed, ticks });
        // 확정 시 중지만 한다 — 배치 잠금은 두지 않는다. 재개는 사람이 토글해야만
        // 가능하고, 토글이 lastWritten을 리셋해 감지가 즉시 재무장되므로 원인이
        // 지속되면(인터락·타 소프트웨어) 다음 이벤트 write 후 ~3틱 안에 다시 걸린다.
        // 앱 슬라이더 개입(manual)과 처벌을 다르게 둘 이유가 없다.
        if (ticks >= DIVERGE_TICKS) {
            // eslint-disable-next-line react-hooks/refs -- monotonic invalidation; extra StrictMode bump is fail-closed
            bumpWriteGenOnRenderStop();
            setWriting(false);
            setActive(false);
            setStopReason('controlDiverged');
        }
    }

    const stop = useCallback(
        (reason: ReplayStopReason = 'manual') => {
            // A confirmation opened before Drop must not cancel the existing safe-off retry.
            if (reason === 'profileChanged' && !active) return;
            // 수동 개입은 active 여부와 무관하게 safe-off 재시도를 취소한다 —
            // 배출 후 사람이 만진 화력을 재시도가 덮으면 안 된다 (#316)
            setSafeOffIssued(false);
            invalidateInFlightWrite();
            if (!active) return;
            setActive(false);
            setStopReason(reason);
        },
        [active, invalidateInFlightWrite],
    );

    useEffect(() => {
        if (safeOffNonce === 0) return;
        // 재생이 화력을 잡은 채 배출됐다 — zero 정책이면 즉시 끈다 (#316, PID off와
        // 동일 타이밍). stopCause 라벨이 아니라 roastFinished를 보는 이유: "끊김+배출"
        // 커밋에서는 우선순위가 'disconnected'로 밀리는데, 그때도 write는 시도해야
        // 실패가 토스트/Sentry로 관측된다. hold면 아무것도 안 쓴다 — 설정으로 선택된
        // 잔류라 PID hold와 같은 등급의 문서화된 동작이다.
        void writeHeater(0, 'safety');
        setSafeOffIssued(true);
    }, [safeOffNonce, writeHeater]);

    // safe-off 재시도 — zero write가 나갔는데 기기가 안 따라오면 다시 쓴다 (#269의
    // PID safe-off와 같은 등급: 아무도 안 보는 로스터에 불이 남는 쪽이 최악이다).
    // 재시도 간격은 unacknowledged 판정 주기(폴링 N회 ≈ 5~10초)가 자연히 만든다 —
    // 매 write가 미반영 카운트를 되돌리므로 tight loop이 될 수 없다.
    useEffect(() => {
        if (!safeOffIssued || !heaterUnacknowledged || !sidecarConnected) return;
        void writeHeater(0, 'safety');
    }, [safeOffIssued, heaterUnacknowledged, sidecarConnected, writeHeater]);

    // Drop 언토글 = 배출 취소. safe-off 재시도가 살아 있으면 재개된 재생을 0으로 덮는다.
    // End 확정 후에는 roastFinished가 true로 고정이라 하강 에지를 만들지 않는다 —
    // 미반영 기기의 재시도를 End가 죽이지 않는다. 새 배치(roastFinished→false)도 여기서 흡수.
    useEffect(() => {
        if (!roastFinished) setSafeOffIssued(false);
    }, [roastFinished]);

    const toggle = useCallback(() => {
        if (active) {
            invalidateInFlightWrite();
            setActive(false);
            setStopReason(null); // 사용자가 직접 껐다 — 안내할 사유가 없다
            return;
        }
        if (plan == null || referenceMachineMismatch || stopCause != null) return;
        invalidateInFlightWrite();
        setStopReason(null);
        // 시작·재개 모두 현재 조건의 마지막 화력으로 동기화한다.
        setIndex(0);
        // 꺼져 있던 동안의 수동 개입이 stale 기준으로 남아 즉시 오판하면 안 된다
        setLastWritten(null);
        setDiverge((d) => ({ ...d, ticks: 0 }));
        // Explicit resume ages from the current last-valid only — never invent one from nowMs.
        setTrustedLastValidMs(lastValidReceivedAtMs ?? null);
        setActive(true);
    }, [active, plan, referenceMachineMismatch, stopCause, invalidateInFlightWrite, lastValidReceivedAtMs]);

    // 현재 generation의 유효 관측이 있을 때만 일반 TIME/BT write. production의 null/unknown
    // (observation 미수신·generation 초기화)은 hold다 — 표시용 last-good BT로 발화하지 않는다.
    // active·index는 유지 — 중단은 R06. DROP zero는 위의 stopCause 경로라 이 게이트 밖이다.
    const observationHold = active && observationQuality !== 'valid';

    // 매 온도 샘플 판정. elapsed도 deps에 있어 BT가 정체해도 시간 트리거는 진행한다.
    // stopCause 가드: pidEngaged/unacknowledged는 새 liveBt와 같은 폴링 커밋에 바뀐다 —
    // 위 중지 effect의 setActive(false)는 다음 렌더에나 반영되므로, 같은 커밋의 이
    // effect가 stale active로 한 번 더 쓰는 것을 여기서 막아야 한다.
    // reconnecting 가드: 링크 복구 대기 중에도 sidecarConnected는 true로 유지되고(세션 보존)
    // elapsed는 호스트 시계라 계속 흘러, 시간축 이벤트가 409로 실패하면서 인덱스만 소비된다.
    // 여기서 멈추면 복구 후 judgeReplay가 밀린 이벤트를 한 번에 따라잡는다.
    // observationHold 가드: 품질이 이벤트 threshold와 같은 커밋에 무효로 바뀌거나,
    // 무효인 채 elapsed만 흘러도 낡은 last-good으로 쓰지 않는다. 정상 복귀 후 이
    // effect가 다시 돌면 기존 Level/순서/catch-up이 최신 정상 샘플로 재평가한다.
    useEffect(() => {
        if (!active || stopCause != null || !roasting || reconnecting || liveBt == null || plan == null) return;
        if (observationQuality !== 'valid') return;
        // 이탈 후보 확정 대기 중(1~2틱)에는 이벤트를 쓰지 않는다 — 여기서 쓰면 실기
        // 개입을 덮는 동시에 lastWritten 갱신·pending으로 판정까지 리셋돼, #307이
        // 막으려던 경로가 확정 창 안에서 재현된다. 노이즈로 판명되면(카운터 0 복귀)
        // 이 effect가 다시 실행되고 judgeReplay가 밀린 이벤트를 한 번에 따라잡는다.
        if (diverge.ticks > 0 || writing) return;
        const result = judgeReplay(plan, index, { bt: liveBt, elapsed, afterTurningPoint });
        if (result.nextIndex === index || result.heater == null) return;
        // 성공을 확인한 뒤에만 index를 전진한다 — 실패한 이벤트는 남겨 두고 fail-closed로
        // 멈춘다. 자동 재시도는 없다: 물리 제어 실패는 사람이 기기를 보고 다시 켠다.
        const heater = result.heater;
        writeGenRef.current += 1;
        const gen = writeGenRef.current;
        const pending = {
            heater,
            nextIndex: result.nextIndex,
            oldEvents: plan.events,
            id: plan.events[index]?.id,
        };
        setPendingWrite(pending);
        setWriting(true);
        void writeHeater(heater).then((applied) => {
            if (gen !== writeGenRef.current) return;
            setPendingWrite(null);
            setWriting(false);
            if (applied != null) {
                const current = labeledEventsRef.current;
                setIndex(current ? remapReplayIndex(pending.oldEvents, pending.nextIndex, current) : result.nextIndex);
                setLastWritten(applied);
                return;
            }
            setActive(false);
            setStopReason('writeFailed');
        });
    }, [
        active,
        stopCause,
        roasting,
        reconnecting,
        liveBt,
        elapsed,
        afterTurningPoint,
        plan,
        index,
        diverge.ticks,
        writing,
        observationQuality,
        writeHeater,
    ]);

    const nextEvent: ReplayEvent | null = active && plan ? (plan.events[index] ?? null) : null;
    const nextEventTrigger = nextEvent && plan ? eventTrigger(nextEvent, plan.tpTime) : null;

    const applyBatchEvents = useCallback((events: ReplayEvent[] | null) => {
        setBatchEvents(events && events.length > 0 ? events : null);
    }, []);

    return {
        plan,
        source: planSource,
        applyBatchEvents,
        overrideInvalid,
        /** 레퍼런스에 Heat set 지시가 있고(합성/PID 기록 아님) 같은 기기이며 쓰기 가능한가 */
        available: plan != null && !referenceMachineMismatch && heaterWritable && sidecarConnected,
        /** 타겟 곡선 로딩 중 — 이전 계획/기록 없음 문구를 쓰지 않는다 */
        referenceLoading: referencePoints == null,
        /** 로드된 레퍼런스에 Heat set 조작 기록이 없다. 실측만 있는 구 TSV 포함 */
        missingHeatSet:
            referencePoints != null &&
            !hasHeatSet &&
            planSource !== 'profile' &&
            planSource !== 'batch' &&
            !overrideInvalid,
        /** 다른 기종 기록 — UI 힌트 분리용 */
        machineMismatch: referenceMachineMismatch,
        /** 지금 켤 수 없는 상태(PID 점유 등) — 토글이 침묵 무시되므로 UI는 disabled로 보여야 한다 */
        blocked: stopCause != null,
        active,
        /** ACK된 이벤트 수. 실행 중 편집에서 이미 보낸 행을 잠글 때 쓴다 */
        firedCount: index,
        /** 마지막 중지 사유 — 재시작·직접 끄기 전까지 유지. UI 안내용 */
        stopReason,
        /** 다음에 발화할 이벤트 — UI 미리보기용. 다 소진했으면 null */
        nextEvent,
        /** 무효 관측으로 일반 이벤트만 보류 중 — 중지 아님. 패널이 정상 재생처럼 보이면 안 된다 */
        observationHold,
        /** nextEvent의 실제 발화축 — judgeReplay와 같은 eventTrigger. Off/소진이면 null */
        nextEventTrigger,
        /** 계획 TP 시각 — 다음 이벤트가 TIME(t ≤ tpTime)인지 BT인지 파생 */
        tpTime: plan?.tpTime ?? null,
        /** 실기 TP 사실 — 패널이 대기/폴백/실감지를 파생한다 */
        confirmedTurningPoint,
        toggle,
        /** 수동 개입 시 부모가 부른다 — 슬라이더 onChange에서, Replay 자신의 쓰기 경로에서는 부르지 않는다 */
        stop,
    };
};
