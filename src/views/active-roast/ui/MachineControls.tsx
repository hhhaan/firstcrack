import { PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';

export const MachineControls = ({
    machineCapabilities,
    sidecarConnected,
    liveData,
}: {
    machineCapabilities: string[];
    sidecarConnected: boolean;
    liveData: { heater: number; fan: number; drum: number } | null;
}) => {
    if (machineCapabilities.length === 0 && sidecarConnected) return null;

    return (
        <div className="flex items-center gap-4 mb-2.5 pl-0.5">
            {(machineCapabilities.includes('heater') || !sidecarConnected) && (
                <span className="text-[13px] text-muted">
                    Heater{' '}
                    <span className="font-mono font-normal" style={{ color: PHASE_COLORS.development }}>
                        {liveData ? `${liveData.heater}%` : '—'}
                    </span>
                </span>
            )}
            {(machineCapabilities.includes('fan') || !sidecarConnected) && (
                <span className="text-[13px] text-muted">
                    Fan{' '}
                    <span className="font-mono font-normal" style={{ color: SENSOR_COLORS.et }}>
                        {liveData ? `${liveData.fan}%` : '—'}
                    </span>
                </span>
            )}
            {(machineCapabilities.includes('drum') || !sidecarConnected) && (
                <span className="text-[13px] text-muted">
                    Drum{' '}
                    <span className="font-mono font-normal" style={{ color: PHASE_COLORS.ready }}>
                        {/* ponytail: 단위 미표기 — drum 단위는 머신마다 다르다(Giesen=Hz).
                            레지스트리에 채널 단위 메타데이터가 생기면 그때 표기 */}
                        {liveData ? `${liveData.drum}` : '—'}
                    </span>
                </span>
            )}
        </div>
    );
};
