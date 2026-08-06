import type { PidRuntime } from '@entities/machine';
import type { ControlRole } from '../lib/controlSender';
import { useMachineControl } from '../model/useMachineControl';
import { PidControlPanel } from './PidControlPanel';
import { SetpointControl } from './SetpointControl';

const ROLE_ORDER: ControlRole[] = ['heater', 'fan', 'drum'];

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
 * 사이드카가 쓰기 가능하다고 보고한 채널만 렌더한다 (`/status.control`).
 * 쓰기 맵이 없는 머신에서는 아예 나타나지 않는다 — 조작할 수 없는 컨트롤을
 * 보여주면 명령이 먹은 것으로 오해할 수 있다.
 */
export const MachineControlPanel = ({
    sidecarConnected,
    liveData,
    pidRuntime,
    roastFinished,
    pidDropBehavior,
}: Props) => {
    const { writable, limits, pidCapability, desired, unacknowledged, sending, setValue, commitNow } =
        useMachineControl(sidecarConnected, liveData);

    const roles = ROLE_ORDER.filter((role) => limits[role] != null);
    if (!writable || roles.length === 0) return null;

    // PID가 화력을 잡고 있는 동안 heater 슬라이더를 열어 두면, 조작해도 다음 tick(1초)에
    // PID가 덮어써서 "슬라이더가 말을 안 듣는" 상태가 된다. 소유권을 명확히 한다.
    const pidHoldsHeater = pidRuntime?.state === 'running' || pidRuntime?.state === 'holding';

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Machine Control</span>
                {sending && <span className="text-[11px] text-muted">sending…</span>}
            </div>
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
    );
};
