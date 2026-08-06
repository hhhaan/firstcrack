import type { ControlRole } from '../lib/controlSender';
import { useMachineControl } from '../model/useMachineControl';
import { SetpointControl } from './SetpointControl';

const ROLE_ORDER: ControlRole[] = ['heater', 'fan', 'drum'];

interface Props {
    sidecarConnected: boolean;
    liveData: { heater: number; fan: number; drum: number } | null;
}

/**
 * 수동 머신 제어 패널.
 *
 * 사이드카가 쓰기 가능하다고 보고한 채널만 렌더한다 (`/status.control`).
 * 쓰기 맵이 없는 머신에서는 아예 나타나지 않는다 — 조작할 수 없는 컨트롤을
 * 보여주면 명령이 먹은 것으로 오해할 수 있다.
 */
export const MachineControlPanel = ({ sidecarConnected, liveData }: Props) => {
    const { writable, limits, desired, sending, setValue, commitNow } = useMachineControl(sidecarConnected);

    const roles = ROLE_ORDER.filter((role) => limits[role] != null);
    if (!writable || roles.length === 0) return null;

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
                    disabled={!writable}
                    onChange={setValue}
                    onCommit={commitNow}
                />
            ))}
        </div>
    );
};
