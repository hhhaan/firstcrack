import type { PidRuntime } from '@entities/machine';
import { FEATURE, useFeature } from '@shared/lib/features';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ControlRole } from '../lib/controlSender';
import { useMachineControl } from '../model/useMachineControl';
import { PidControlPanel } from './PidControlPanel';
import { SetpointControl } from './SetpointControl';

const ROLE_ORDER: ControlRole[] = ['heater', 'fan', 'drum'];

const PID_DOT: Record<string, string> = {
    running: 'bg-emerald-500',
    holding: 'bg-amber-500',
    fault: 'bg-red-500',
};

interface Props {
    sidecarConnected: boolean;
    liveData: { heater: number; fan: number; drum: number } | null;
    pidRuntime: PidRuntime | null;
    /** 배출·로스팅 종료 — PID 자동 해제 신호 */
    roastFinished: boolean;
    pidDropBehavior: 'hold' | 'zero';
}

/**
 * 머신 제어 묶음 — 수동 setpoint + 자동 화력(PID).
 *
 * Active roast 중간 열 (그래프 | 이 패널 | 온도 패널).
 * 접으면 얇은 레일만 남기고 차트 폭을 확보한다. 접힌 동안에도 본 트리는 유지해
 * PID/DROP 훅이 언마운트되지 않는다.
 *
 * 사이드카가 쓰기 가능하다고 보고한 채널만 렌더한다 (`/status.control`).
 */
export const MachineControlPanel = ({
    sidecarConnected,
    liveData,
    pidRuntime,
    roastFinished,
    pidDropBehavior,
}: Props) => {
    const entitled = useFeature(FEATURE.machineControl);
    const { writable, limits, pidCapability, desired, unacknowledged, sending, setValue, commitNow } =
        useMachineControl(sidecarConnected, liveData);
    const [collapsed, setCollapsed] = useState(false);

    const roles = ROLE_ORDER.filter((role) => limits[role] != null);
    // PID가 화력을 잡고 있는 동안 heater 슬라이더를 열어 두면, 조작해도 다음 tick(1초)에
    // PID가 덮어써서 "슬라이더가 말을 안 듣는" 상태가 된다. 소유권을 명확히 한다.
    const pidHoldsHeater = pidRuntime?.state === 'running' || pidRuntime?.state === 'holding';
    const pidState = pidRuntime?.state ?? 'off';
    const statusDot = PID_DOT[pidState];

    // Pro+ 전용. 게이트를 여기 한 곳에만 두는 이유: 슬라이더와 PID가 같은 쓰기 권한을
    // 공유하므로, 화력을 쓸 수 없으면 PID도 의미가 없다.
    //
    // 단 PID가 돌고 있으면 권한과 무관하게 계속 렌더한다. 이 패널이 사라지면 DROP 시
    // 자동 해제 훅도 같이 사라져, 아무도 안 보는 로스터에 불이 계속 들어간다.
    // (플랜 스토어가 로딩 중 잠깐 비entitled로 보일 수 있다)
    if ((!entitled && !pidHoldsHeater) || !writable || roles.length === 0) return null;

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
            </div>

            {/* 접혀도 트리 유지 — PID/DROP 훅 언마운트 방지 */}
            <div className={collapsed ? 'hidden' : 'flex flex-col gap-3'} aria-hidden={collapsed}>
                {sending && <span className="text-[11px] text-muted">sending…</span>}
                {roles.map((role) => (
                    <SetpointControl
                        key={role}
                        role={role}
                        limit={limits[role] ?? {}}
                        value={desired[role]}
                        feedback={liveData ? liveData[role] : null}
                        unacknowledged={unacknowledged.has(role)}
                        disabled={!writable || (role === 'heater' && pidHoldsHeater)}
                        lockedNote={role === 'heater' && pidHoldsHeater ? 'PID 제어 중' : undefined}
                        onChange={setValue}
                        onCommit={commitNow}
                    />
                ))}
                <PidControlPanel
                    sidecarConnected={sidecarConnected}
                    capability={pidCapability}
                    runtime={pidRuntime}
                    roastFinished={roastFinished}
                    dropBehavior={pidDropBehavior}
                />
            </div>
        </div>
    );
};
