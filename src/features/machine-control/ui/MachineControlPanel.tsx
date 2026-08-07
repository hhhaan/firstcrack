import type { PidRuntime } from '@entities/machine';
import { FEATURE, useFeature } from '@shared/lib/features';
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
    const entitled = useFeature(FEATURE.machineControl);
    const { writable, limits, pidCapability, desired, unacknowledged, sending, setValue, commitNow } =
        useMachineControl(sidecarConnected, liveData);

    const roles = ROLE_ORDER.filter((role) => limits[role] != null);
    // PID가 화력을 잡고 있는 동안 heater 슬라이더를 열어 두면, 조작해도 다음 tick(1초)에
    // PID가 덮어써서 "슬라이더가 말을 안 듣는" 상태가 된다. 소유권을 명확히 한다.
    const pidHoldsHeater = pidRuntime?.state === 'running' || pidRuntime?.state === 'holding';

    // Pro+ 전용. 게이트를 여기 한 곳에만 두는 이유: 슬라이더와 PID가 같은 쓰기 권한을
    // 공유하므로, 화력을 쓸 수 없으면 PID도 의미가 없다.
    //
    // 단 PID가 돌고 있으면 권한과 무관하게 계속 렌더한다. 이 패널이 사라지면 DROP 시
    // 자동 해제 훅도 같이 사라져, 아무도 안 보는 로스터에 불이 계속 들어간다.
    // (플랜 스토어가 로딩 중 잠깐 비entitled로 보일 수 있다)
    if ((!entitled && !pidHoldsHeater) || !writable || roles.length === 0) return null;

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
