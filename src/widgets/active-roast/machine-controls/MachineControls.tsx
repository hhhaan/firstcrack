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
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 10, paddingLeft: 2 }}>
            {(machineCapabilities.includes('heater') || !sidecarConnected) && (
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    Heater{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ea580c' }}>
                        {liveData ? `${liveData.heater}%` : '—'}
                    </span>
                </span>
            )}
            {(machineCapabilities.includes('fan') || !sidecarConnected) && (
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    Fan{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#2563eb' }}>
                        {liveData ? `${liveData.fan}%` : '—'}
                    </span>
                </span>
            )}
            {(machineCapabilities.includes('drum') || !sidecarConnected) && (
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    Drum{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#16a34a' }}>
                        {liveData ? `${liveData.drum} RPM` : '—'}
                    </span>
                </span>
            )}
        </div>
    );
};
