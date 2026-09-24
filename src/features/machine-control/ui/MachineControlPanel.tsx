import type { ControlCapability } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { FEATURE, useFeature } from '@shared/lib/features';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ControlCommand, ControlRole } from '../lib/controlSender';
import { numericHeaterStep } from '../lib/heater-events';
import type { ReplayPoint } from '../lib/replay';
import { collapsedReplayTpChrome, isReplayTpHold, resolveReplayTpWait } from '../lib/replayStatus';
import { isPercentUnit } from '../lib/snapPercent';
import type { MachineControlComposition } from '../model/useMachineControlComposition';
import { ChannelChip } from './ChannelChip';
import { HeaterEventsEditor } from './HeaterEventsEditor';
import { HeaterScale } from './HeaterScale';
import { PidControlPanel } from './PidControlPanel';
import { REPLAY_OBSERVATION_HOLD_TEXT, ReplayControlPanel } from './ReplayControlPanel';
import { SetpointControl } from './SetpointControl';

const ROLE_ORDER: ControlRole[] = ['heater', 'fan', 'drum'];

const PID_DOT: Record<string, string> = {
    running: 'bg-emerald-500',
    holding: 'bg-amber-500',
    fault: 'bg-red-500',
};

interface Props {
    /** Control lifetime lives in the parent. Hiding this panel must not unmount it. */
    model: MachineControlComposition;
    liveData: { heater: number | null; fan: number; drum: number } | null;
    /** Curve points for the batch heat editor. Replay itself reads the same points via the model. */
    replayPoints: ReplayPoint[] | null;
    pidDropBehavior: 'hold' | 'zero';
    /** 표시 온도 단위 — Replay 안내 문구용 */
    temperatureUnit: 'C' | 'F';
}

/**
 * 머신 제어 묶음 — 수동 setpoint + 자동 화력(PID).
 *
 * Active roast 중간 열 (그래프 | 이 패널 | 온도 패널).
 * 제어 수명은 useMachineControlComposition이다. 이 패널이 null을 반환하거나
 * 접혀도 PID/Replay 훅은 언마운트되지 않는다.
 *
 * % 히터 A′: Fan/Drum 칩은 limits에 있는 채널만. 없으면 숨기고 HeaterScale이 flex-1로 채운다.
 * 0–10 기센 fader는 기존 3칸(미지원은 disabled).
 */
export const MachineControlPanel = ({ model, liveData, replayPoints, pidDropBehavior, temperatureUnit }: Props) => {
    const { t } = useTranslation();
    const entitled = useFeature(FEATURE.machineControl);
    const { machine, pid, replay, pidActive, changeManual, commitManual } = model;
    const { writable, limits, desired, unacknowledged, sending } = machine;
    const [collapsed, setCollapsed] = useState(false);
    const [heatEditorOpen, setHeatEditorOpen] = useState(false);

    const anyWritableChannel = ROLE_ORDER.some((role) => limits[role] != null);
    const chipRoles = (['fan', 'drum'] as const).filter((role) => limits[role] != null);
    // PID가 화력을 잡고 있는 동안 heater 슬라이더를 열어 두면, 조작해도 다음 tick(1초)에
    // PID가 덮어써서 "슬라이더가 말을 안 듣는" 상태가 된다. 소유권을 명확히 한다.
    const pidHoldsHeater = pid.engaged;
    const pidState = pid.state;
    const statusDot = PID_DOT[pidState];
    const anyUnacknowledged = ROLE_ORDER.some((role) => limits[role] != null && unacknowledged.has(role));
    const replayTpWait = resolveReplayTpWait({
        active: replay.active,
        nextEvent: replay.nextEvent,
        tpTime: replay.tpTime,
        confirmedTurningPoint: replay.confirmedTurningPoint,
    });
    const replayChrome = collapsedReplayTpChrome(replay.active, replayTpWait);
    let holdLabel: string | undefined;
    if (replayChrome === 'waiting') holdLabel = t('activeRoast.replay.tp.collapsedWaiting');
    else if (replayChrome === 'fallback') holdLabel = t('activeRoast.replay.tp.collapsedFallback');

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
                {collapsed && (
                    <CollapsedRailDots
                        statusDot={statusDot}
                        pidState={pidState}
                        replayChrome={replayChrome}
                        observationHold={replay.observationHold}
                        holdLabel={holdLabel}
                        anyUnacknowledged={anyUnacknowledged}
                    />
                )}
            </div>

            {/* 접혀도 트리 유지 — PID/DROP 훅 언마운트 방지 */}
            <div className={collapsed ? 'hidden' : 'flex min-h-0 flex-1 flex-col gap-3'} aria-hidden={collapsed}>
                <MachineControlChannels
                    limits={limits}
                    desired={desired}
                    liveData={liveData}
                    unacknowledged={unacknowledged}
                    writable={writable}
                    sending={sending}
                    pidHoldsHeater={pidHoldsHeater}
                    replayActive={replay.active}
                    chipRoles={chipRoles}
                    onChange={changeManual}
                    onCommit={commitManual}
                />
                {/* fader 열은 좁아 문장이 안 들어간다 — 경고는 패널 폭 전체를 쓴다 */}
                {anyUnacknowledged && (
                    <p className="text-[11px] leading-snug text-red-500">
                        기기가 명령을 반영하지 않았습니다. 조작반이 원격 제어를 허용하는지 확인하세요.
                    </p>
                )}
                <ReplayControlPanel
                    replay={replay}
                    unit={temperatureUnit}
                    heaterUnit={limits.heater?.unit ?? '%'}
                    onEditHeat={() => setHeatEditorOpen(true)}
                />
                {heatEditorOpen && (
                    <HeaterEventsEditor
                        mode="batch"
                        events={replay.plan?.events ?? []}
                        tpTime={replay.plan?.tpTime ?? Number.POSITIVE_INFINITY}
                        btPoints={replayPoints ?? []}
                        source={replay.source}
                        unit={temperatureUnit}
                        heaterMin={limits.heater?.min}
                        heaterMax={limits.heater?.max}
                        heaterUnit={limits.heater?.unit ?? '%'}
                        heaterStep={numericHeaterStep((limits.heater as { step?: unknown } | undefined)?.step)}
                        lockedCount={replay.active ? replay.firedCount : 0}
                        onClose={() => setHeatEditorOpen(false)}
                        onApply={(events) => {
                            replay.applyBatchEvents(events);
                            setHeatEditorOpen(false);
                        }}
                    />
                )}
                {/* PID 진입 UI는 임시 숨김. 이미 작동 중이면 해제·오류 확인은 유지한다. */}
                {pidActive && <PidControlPanel pid={pid} dropBehavior={pidDropBehavior} replayActive={replay.active} />}
            </div>
        </div>
    );
};

const CollapsedRailDots = ({
    statusDot,
    pidState,
    replayChrome,
    observationHold,
    holdLabel,
    anyUnacknowledged,
}: {
    statusDot?: string;
    pidState: string;
    replayChrome: ReturnType<typeof collapsedReplayTpChrome>;
    observationHold: boolean;
    holdLabel?: string;
    anyUnacknowledged: boolean;
}) => (
    <>
        {statusDot && (
            <span
                role="img"
                className={`h-2 w-2 rounded-full ${statusDot}`}
                title={`PID ${pidState}`}
                aria-label={`PID ${pidState}`}
            />
        )}
        {/* 접혀도 Replay가 히터를 잡고 있다는 표시는 보여야 한다 (#300). 대기/폴백은 정상 재생과 구분. */}
        {replayChrome === 'running' && (
            <span
                role="img"
                className={`h-2 w-2 rounded-full ${observationHold ? 'bg-amber-500' : 'bg-emerald-500'}`}
                title={observationHold ? REPLAY_OBSERVATION_HOLD_TEXT : 'Replay 재생 중'}
                aria-label={observationHold ? REPLAY_OBSERVATION_HOLD_TEXT : 'Replay 재생 중'}
            />
        )}
        {isReplayTpHold(replayChrome) && (
            <span role="img" className="h-2 w-2 rounded-full bg-amber-500" title={holdLabel} aria-label={holdLabel} />
        )}
        {/* 접혀도 미반영 경고는 보여야 한다 — 원격 제어 거부를 모른 채 지나칠 수 있다 (#269) */}
        {anyUnacknowledged && (
            <span
                role="img"
                className="h-2 w-2 rounded-full bg-red-500"
                title="기기가 명령을 반영하지 않았습니다"
                aria-label="기기가 명령을 반영하지 않았습니다"
            />
        )}
    </>
);

const MachineControlChannels = ({
    limits,
    desired,
    liveData,
    unacknowledged,
    writable,
    sending,
    pidHoldsHeater,
    replayActive,
    chipRoles,
    onChange,
    onCommit,
}: {
    limits: ControlCapability['limits'];
    desired: ControlCommand;
    liveData: { heater: number | null; fan: number; drum: number } | null;
    unacknowledged: Set<ControlRole>;
    writable: boolean;
    sending: boolean;
    pidHoldsHeater: boolean;
    replayActive: boolean;
    chipRoles: Array<'fan' | 'drum'>;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}) => {
    if (isPercentUnit(limits.heater?.unit)) {
        return (
            <>
                <HeaterScale
                    limit={limits.heater ?? {}}
                    value={limits.heater != null ? desired.heater : undefined}
                    feedback={limits.heater != null && liveData ? liveData.heater : null}
                    unacknowledged={limits.heater != null && unacknowledged.has('heater')}
                    disabled={!writable || limits.heater == null || pidHoldsHeater || replayActive}
                    unsupported={limits.heater == null}
                    sending={sending}
                    lockedNote={
                        limits.heater == null ? 'N/A' : pidHoldsHeater ? 'PID' : replayActive ? 'Replay' : undefined
                    }
                    onChange={onChange}
                    onCommit={onCommit}
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
                                onChange={onChange}
                                onCommit={onCommit}
                            />
                        ))}
                    </div>
                )}
            </>
        );
    }
    return (
        <div className={cn('flex min-h-24 flex-1 justify-around gap-1', sending && 'opacity-40')}>
            {ROLE_ORDER.map((role) => {
                const supported = limits[role] != null;
                const lockedByPid = role === 'heater' && pidHoldsHeater;
                // Replay 재생 중 화력 소유권은 Replay에 있다 — 수동 조절은 체크 해제 후.
                // (fan/drum은 Replay가 안 만지므로 열어둔다)
                const lockedByReplay = role === 'heater' && replayActive;
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
                        lockedNote={!supported ? 'N/A' : lockedByPid ? 'PID' : lockedByReplay ? 'Replay' : undefined}
                        onChange={onChange}
                        onCommit={onCommit}
                    />
                );
            })}
        </div>
    );
};
