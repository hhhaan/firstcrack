import { FEATURE, useFeature } from '@shared/lib/features';
import {
    formatShortcut,
    SHORTCUT_HOTKEY_OPTIONS,
    shortcutHotkeys,
    useShortcutKeys,
    useShortcutStore,
} from '@shared/store/keyboard-shortcuts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { isMachineControlPanelShown, MACHINE_CONTROL_CHANNEL_ROLES } from '../lib/controlPanelShown';
import { numericHeaterStep } from '../lib/heater-events';
import type { ReplayPoint } from '../lib/replay';
import type { MachineControlComposition } from '../model/useMachineControlComposition';
import { CollapsedControlStatus } from './CollapsedControlStatus';
import { HeaterEventsEditor } from './HeaterEventsEditor';
import { MachineControlChannels } from './MachineControlChannels';
import { PidControlPanel } from './PidControlPanel';
import { ReplayControlPanel } from './ReplayControlPanel';

interface Props {
    /** Control lifetime lives in the parent. Hiding this panel must not unmount it. */
    model: MachineControlComposition;
    liveData: { heater: number | null; fan: number; drum: number } | null;
    /** Curve points for the batch heat editor. Replay itself reads the same points via the model. */
    replayPoints: ReplayPoint[] | null;
    pidDropBehavior: 'hold' | 'zero';
    /** 표시 온도 단위 — Replay 안내 문구용 */
    temperatureUnit: 'C' | 'F';
    hotkeysEnabled?: boolean;
}

/**
 * 머신 제어 묶음 — 접힘·편집창과 채널·PID·Replay 표시.
 *
 * 제어 수명은 useMachineControlComposition이다. 이 패널이 null을 반환하거나
 * 접혀도 PID/Replay 훅은 언마운트되지 않는다. 패널을 그릴지는
 * isMachineControlPanelShown이고, 전송 허용은 model이다.
 */
export const MachineControlPanel = ({
    model,
    liveData,
    replayPoints,
    pidDropBehavior,
    temperatureUnit,
    hotkeysEnabled = false,
}: Props) => {
    const entitled = useFeature(FEATURE.machineControl);
    const { machine, discharge, pid, replay, pidActive, changeManual, commitManual } = model;
    const { writable, limits, desired, unacknowledged, sending } = machine;
    const [collapsed, setCollapsed] = useState(false);
    const [heatEditorOpen, setHeatEditorOpen] = useState(false);
    const toggleControlKeys = useShortcutKeys('toggleControl');
    const shortcutsBlocked = useShortcutStore((state) => state.recording || state.dialogOpen);

    const hasChannel = MACHINE_CONTROL_CHANNEL_ROLES.some((role) => limits[role] != null);
    const panelVisible = isMachineControlPanelShown({ pidActive, entitled, writable, hasChannel });
    useHotkeys(
        shortcutHotkeys(toggleControlKeys),
        (e) => {
            e.preventDefault();
            setCollapsed((collapsed) => !collapsed);
        },
        {
            enabled: hotkeysEnabled && panelVisible && !shortcutsBlocked && toggleControlKeys.length > 0,
            ...SHORTCUT_HOTKEY_OPTIONS,
        },
        [hotkeysEnabled, panelVisible],
    );
    if (!panelVisible) return null;

    // PID가 화력을 잡고 있는 동안 heater 슬라이더를 열어 두면, 조작해도 다음 tick(1초)에
    // PID가 덮어써서 "슬라이더가 말을 안 듣는" 상태가 된다. 소유권을 명확히 한다.
    const pidHoldsHeater = pid.engaged;
    const anyUnacknowledged = MACHINE_CONTROL_CHANNEL_ROLES.some(
        (role) => limits[role] != null && unacknowledged.has(role),
    );

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
                    aria-keyshortcuts={toggleControlKeys[0]}
                    title={`${collapsed ? 'Expand' : 'Collapse'} machine control (${formatShortcut(toggleControlKeys)})`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-secondary hover:text-primary hover:bg-surface dark:hover:bg-surface-elevated cursor-pointer border-none bg-transparent"
                >
                    {collapsed ? <ChevronLeft size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                </button>
                {collapsed && (
                    <CollapsedControlStatus
                        pidState={pid.state}
                        anyUnacknowledged={anyUnacknowledged}
                        replay={replay}
                    />
                )}
            </div>

            {/* 접혀도 트리 유지 — 표시 전환이 PID/Replay 패널을 언마운트하지 않는다 */}
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
                    onChange={changeManual}
                    onCommit={commitManual}
                />
                {discharge.available && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold text-secondary">배출문</span>
                        <div className="flex gap-1">
                            {(['open', 'close'] as const).map((action) => (
                                <button
                                    key={action}
                                    type="button"
                                    disabled={discharge.sending}
                                    onClick={() => void discharge.send(action)}
                                    className="flex-1 rounded-md border border-border-subtle px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {action === 'open' ? '열기' : '닫기'}
                                </button>
                            ))}
                        </div>
                        <span className="text-[10px] leading-snug text-muted">
                            Drop 버튼을 누르면 열기 명령을 보냅니다.
                        </span>
                    </div>
                )}
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
