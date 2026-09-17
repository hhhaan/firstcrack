import type { PidRuntime } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { FEATURE, useFeature } from '@shared/lib/features';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlCommand, ControlRole } from '../lib/controlSender';
import type { ReplayPoint } from '../lib/replay';
import { isPercentUnit } from '../lib/snapPercent';
import { useMachineControl } from '../model/useMachineControl';
import { usePidControl } from '../model/usePidControl';
import { useReplayControl } from '../model/useReplayControl';
import { ChannelChip } from './ChannelChip';
import { HeaterScale } from './HeaterScale';
import { PidControlPanel } from './PidControlPanel';
import { ReplayControlPanel } from './ReplayControlPanel';
import { SetpointControl } from './SetpointControl';

const ROLE_ORDER: ControlRole[] = ['heater', 'fan', 'drum'];

const PID_DOT: Record<string, string> = {
    running: 'bg-emerald-500',
    holding: 'bg-amber-500',
    fault: 'bg-red-500',
};

interface Props {
    sidecarConnected: boolean;
    /** 사이드카 재연결 대기 — 실측 동결 중이라 이탈 카운트를 멈춘다 (#307) */
    reconnecting: boolean;
    liveData: { heater: number | null; fan: number; drum: number } | null;
    pidRuntime: PidRuntime | null;
    /** 배출·로스팅 종료 — PID 자동 해제 신호 */
    roastFinished: boolean;
    pidDropBehavior: 'hold' | 'zero';
    /** 타겟 프로파일 커브 — Replay Assist 레퍼런스 (#300). 없으면 Replay 숨김 */
    replayPoints: ReplayPoint[] | null;
    /** 레퍼런스가 다른 기종 기록 — Replay 차단 (같은 기기만 재생) */
    replayMachineMismatch: boolean;
    /** 레퍼런스의 charge→drop 초 — 배출 후 기록 제외용 */
    replayDropTime: number | null;
    liveBt: number | null;
    elapsed: number;
    roasting: boolean;
    /** 실기 TP 확정 여부 — 하강 구간 BT 트리거 오발 방지 */
    afterTurningPoint: boolean;
    /** 표시 온도 단위 — Replay 안내 문구용 */
    temperatureUnit: 'C' | 'F';
    /** 사용자·Replay가 화력 전송을 확정한 순간의 값 */
    onHeaterCommitted?: (value: number, unit: string) => void;
}

/**
 * 머신 제어 묶음 — 수동 setpoint + 자동 화력(PID).
 *
 * Active roast 중간 열 (그래프 | 이 패널 | 온도 패널).
 * 접으면 얇은 레일만 남기고 차트 폭을 확보한다. 접힌 동안에도 본 트리는 유지해
 * PID/DROP 훅이 언마운트되지 않는다.
 *
 * % 히터 A′: Fan/Drum 칩은 limits에 있는 채널만. 없으면 숨기고 HeaterScale이 flex-1로 채운다.
 * 0–10 기센 fader는 기존 3칸(미지원은 disabled).
 */
export const MachineControlPanel = ({
    sidecarConnected,
    reconnecting,
    liveData,
    pidRuntime,
    roastFinished,
    pidDropBehavior,
    replayPoints,
    replayMachineMismatch,
    replayDropTime,
    liveBt,
    elapsed,
    roasting,
    afterTurningPoint,
    temperatureUnit,
    onHeaterCommitted,
}: Props) => {
    const entitled = useFeature(FEATURE.machineControl);
    const heaterUnitRef = useRef('%');
    const handleCommitted = useCallback(
        (committed: ControlCommand) => {
            if (committed.heater !== undefined) onHeaterCommitted?.(committed.heater, heaterUnitRef.current);
        },
        [onHeaterCommitted],
    );
    const { writable, limits, pidCapability, desired, unacknowledged, sending, setValue, commitNow } =
        useMachineControl(sidecarConnected, liveData, handleCommitted);
    useEffect(() => {
        heaterUnitRef.current = limits.heater?.unit ?? '%';
    }, [limits.heater?.unit]);
    // PID 수명 훅(DROP 자동 해제 포함)은 표시 조건과 무관하게 이 컴포넌트에 산다.
    // PidControlPanel 안에 두면 아래 가드가 null을 반환하는 순간 — capability 일시
    // 실패 등 — 훅이 언마운트돼 배출 후에도 버너가 켜진 채 남는다(#269).
    const pid = usePidControl({
        sidecarConnected,
        capability: pidCapability,
        runtime: pidRuntime,
        roastFinished,
        dropBehavior: pidDropBehavior,
    });
    const [collapsed, setCollapsed] = useState(false);

    const anyWritableChannel = ROLE_ORDER.some((role) => limits[role] != null);
    const chipRoles = (['fan', 'drum'] as const).filter((role) => limits[role] != null);
    // PID가 화력을 잡고 있는 동안 heater 슬라이더를 열어 두면, 조작해도 다음 tick(1초)에
    // PID가 덮어써서 "슬라이더가 말을 안 듣는" 상태가 된다. 소유권을 명확히 한다.
    const pidHoldsHeater = pidRuntime?.state === 'running' || pidRuntime?.state === 'holding';
    const pidState = pidRuntime?.state ?? 'off';
    const statusDot = PID_DOT[pidState];
    // fault 포함 — 화력이 남았을 수 있는 동안은 상태·에러가 계속 보여야 한다
    const pidActive = pidState !== 'off';
    const anyUnacknowledged = ROLE_ORDER.some((role) => limits[role] != null && unacknowledged.has(role));

    // Replay 쓰기 경로 — setValue만으로는 전송되지 않는다(드래그 억제 설계), commit까지 한 쌍
    const writeHeater = useCallback(
        async (value: number) => {
            setValue('heater', value);
            const applied = await commitNow();
            return applied?.heater ?? null;
        },
        [setValue, commitNow],
    );
    const replay = useReplayControl({
        referencePoints: replayPoints,
        referenceMachineMismatch: replayMachineMismatch,
        referenceDropTime: replayDropTime,
        liveBt,
        elapsed,
        roasting,
        afterTurningPoint,
        heaterWritable: writable && limits.heater != null,
        // fault 포함 — PID가 off가 아닌 동안 히터 소유권을 넘기지 않는다
        pidEngaged: pidActive,
        roastFinished,
        sidecarConnected,
        heaterUnacknowledged: unacknowledged.has('heater'),
        // 배출 시 화력 정책은 PID와 공용 — "DROP 후 화력"은 구동 주체와 무관한 한 정책 (#316)
        dropBehavior: pidDropBehavior,
        // 외부 개입(지속 이탈) 감지 재료 (#307) — 실측과 "지시 미수렴" 상태
        heaterFeedback: liveData?.heater ?? null,
        heaterPending: desired.heater != null,
        reconnecting,
        writeHeater,
        heaterMax: limits.heater?.max,
    });
    // 수동 개입은 슬라이더 콜백에서만 감지한다 — Replay 자신의 setValue가 자기를 중지시키면 안 된다.
    // 재생 중 heater 슬라이더는 잠기므로 평소엔 닿지 않는 경로지만, 드래그 도중
    // 재생이 켜지는 경계에서 이벤트가 새면 여기가 마지막 방어선이다.
    const handleManualChange = useCallback(
        (role: ControlRole, value: number) => {
            if (role === 'heater') replay.stop();
            setValue(role, value);
        },
        [replay.stop, setValue],
    );

    // Pro+ 전용. 게이트를 여기 한 곳에만 두는 이유: 슬라이더와 PID가 같은 쓰기 권한을
    // 공유하므로, 화력을 쓸 수 없으면 PID도 의미가 없다.
    //
    // 단 PID가 off가 아니면 권한·capability와 무관하게 계속 렌더한다 — 상태와 fault
    // 에러가 보여야 하고, 플랜 스토어가 로딩 중 잠깐 비entitled로 보일 수 있다.
    if (!pidActive && (!entitled || !writable || !anyWritableChannel)) return null;

    return (
        <div
            className={
                collapsed
                    ? 'w-7 shrink-0 self-stretch min-h-0 border-l border-border-subtle flex flex-col items-center gap-2 pt-2 pb-3 bg-(--color-roast-bg)'
                    : 'w-40 shrink-0 self-stretch min-h-0 border-l border-border-subtle overflow-y-auto px-2.5 pb-5 pt-1 flex flex-col gap-3 bg-(--color-roast-bg) [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
            }
        >
            <div className={collapsed ? 'flex flex-col items-center gap-2' : 'flex items-center justify-between gap-1'}>
                {!collapsed && (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Machine Control
                    </span>
                )}
                <button
                    type="button"
                    onClick={() => setCollapsed((c) => !c)}
                    aria-label={collapsed ? 'Expand machine control' : 'Collapse machine control'}
                    aria-expanded={!collapsed}
                    title={collapsed ? 'Expand machine control' : 'Collapse machine control'}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-secondary hover:text-primary hover:bg-surface dark:hover:bg-surface-elevated cursor-pointer border-none bg-transparent"
                >
                    {collapsed ? <ChevronLeft size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                </button>
                {collapsed && statusDot && (
                    <span
                        role="img"
                        className={`h-2 w-2 rounded-full ${statusDot}`}
                        title={`PID ${pidState}`}
                        aria-label={`PID ${pidState}`}
                    />
                )}
                {/* 접혀도 Replay가 히터를 잡고 있다는 표시는 보여야 한다 (#300) */}
                {collapsed && replay.active && (
                    <span
                        role="img"
                        className="h-2 w-2 rounded-full bg-emerald-500"
                        title="Replay 재생 중"
                        aria-label="Replay 재생 중"
                    />
                )}
                {/* 접혀도 미반영 경고는 보여야 한다 — 원격 제어 거부를 모른 채 지나칠 수 있다 (#269) */}
                {collapsed && anyUnacknowledged && (
                    <span
                        role="img"
                        className="h-2 w-2 rounded-full bg-red-500"
                        title="기기가 명령을 반영하지 않았습니다"
                        aria-label="기기가 명령을 반영하지 않았습니다"
                    />
                )}
            </div>

            {/* 접혀도 트리 유지 — PID/DROP 훅 언마운트 방지 */}
            <div className={collapsed ? 'hidden' : 'flex min-h-0 flex-1 flex-col gap-3'} aria-hidden={collapsed}>
                {/* % 히터는 A′ 세로 눈금, Fan/Drum은 칩. step(0–10) 기센은 기존 fader (#436) */}
                {isPercentUnit(limits.heater?.unit) ? (
                    <>
                        <HeaterScale
                            limit={limits.heater ?? {}}
                            value={limits.heater != null ? desired.heater : undefined}
                            feedback={limits.heater != null && liveData ? liveData.heater : null}
                            unacknowledged={limits.heater != null && unacknowledged.has('heater')}
                            disabled={!writable || limits.heater == null || pidHoldsHeater || replay.active}
                            unsupported={limits.heater == null}
                            sending={sending}
                            lockedNote={
                                limits.heater == null
                                    ? 'N/A'
                                    : pidHoldsHeater
                                      ? 'PID'
                                      : replay.active
                                        ? 'Replay'
                                        : undefined
                            }
                            onChange={handleManualChange}
                            onCommit={commitNow}
                        />
                        {chipRoles.length > 0 && (
                            <div className="flex shrink-0 flex-col gap-1.5">
                                {chipRoles.map((role) => (
                                    <ChannelChip
                                        key={role}
                                        role={role}
                                        limit={limits[role] ?? {}}
                                        value={desired[role]}
                                        feedback={liveData ? liveData[role] : null}
                                        unacknowledged={unacknowledged.has(role)}
                                        disabled={!writable}
                                        onChange={handleManualChange}
                                        onCommit={commitNow}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className={cn('flex min-h-24 flex-1 justify-around gap-1', sending && 'opacity-40')}>
                        {ROLE_ORDER.map((role) => {
                            const supported = limits[role] != null;
                            const lockedByPid = role === 'heater' && pidHoldsHeater;
                            // Replay 재생 중 화력 소유권은 Replay에 있다 — 수동 조절은 체크 해제 후.
                            // (fan/drum은 Replay가 안 만지므로 열어둔다)
                            const lockedByReplay = role === 'heater' && replay.active;
                            return (
                                <SetpointControl
                                    key={role}
                                    role={role}
                                    limit={limits[role] ?? {}}
                                    value={supported ? desired[role] : undefined}
                                    feedback={supported && liveData ? liveData[role] : null}
                                    unacknowledged={supported && unacknowledged.has(role)}
                                    disabled={!writable || !supported || lockedByPid || lockedByReplay}
                                    unsupported={!supported}
                                    lockedNote={
                                        !supported ? 'N/A' : lockedByPid ? 'PID' : lockedByReplay ? 'Replay' : undefined
                                    }
                                    onChange={handleManualChange}
                                    onCommit={commitNow}
                                />
                            );
                        })}
                    </div>
                )}
                {/* fader 열은 좁아 문장이 안 들어간다 — 경고는 패널 폭 전체를 쓴다 */}
                {anyUnacknowledged && (
                    <p className="text-[11px] leading-snug text-red-500">
                        기기가 명령을 반영하지 않았습니다. 조작반이 원격 제어를 허용하는지 확인하세요.
                    </p>
                )}
                <ReplayControlPanel replay={replay} unit={temperatureUnit} />
                <PidControlPanel pid={pid} dropBehavior={pidDropBehavior} replayActive={replay.active} />
            </div>
        </div>
    );
};
