import { Settings2, ChevronDown } from 'lucide-react';
import { roastProfiles, DEFAULT_PROFILE_KEY } from '@shared/data/roast-profiles';
import { useRoastingStore } from '@features/active-roast/model/status';
import { STATUS_COLORS, PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';

export const RoastHeader = ({
    phase,
    targetProfileId,
    onTargetProfileChange,
    onOpenRoastSettings,
}: {
    phase: string;
    targetProfileId: number | null;
    onTargetProfileChange: (id: number | null) => void;
    onOpenRoastSettings?: () => void;
}) => {
    const roastEnded = useRoastingStore((s) => s.phase === 'ended');
    const charged = useRoastingStore((s) => s.charged);
    const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
    const elapsed = useRoastingStore((s) => s.elapsed);

    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;
    const timeStr = charged ? `${elapsedMin}:${String(elapsedSec).padStart(2, '0')}` : '—';

    const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        const id = val === '' ? null : Number(val);
        onTargetProfileChange(id);
        if (id != null) localStorage.setItem(DEFAULT_PROFILE_KEY, String(id));
        else localStorage.removeItem(DEFAULT_PROFILE_KEY);
    };

    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: roastEnded || !sidecarConnected ? '#6b7280' : STATUS_COLORS.active,
                            boxShadow:
                                !roastEnded && sidecarConnected && charged ? `0 0 0 3px ${STATUS_COLORS.activeGlow}` : 'none',
                            animation: sidecarConnected && charged && !roastEnded ? 'pulse 2s infinite' : 'none',
                        }}
                    />
                    <span
                        style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: roastEnded || !sidecarConnected ? '#6b7280' : PHASE_COLORS.ready,
                            letterSpacing: '0.5px',
                            textTransform: 'uppercase',
                        }}
                    >
                        {roastEnded
                            ? 'Roast Complete'
                            : !sidecarConnected
                              ? charged
                                  ? 'Mock — Roast in Progress'
                                  : 'Disconnected'
                              : !charged
                                ? 'Machine Connected · Ready to Roast'
                                : 'Live — Roast in Progress'}
                    </span>
                </div>
                <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                    Ethiopia Yirgacheffe
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                        Natural · Guji Zone · Target:
                    </span>
                    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                        <select
                            value={targetProfileId ?? ''}
                            onChange={handleProfileChange}
                            disabled={charged}
                            style={{
                                appearance: 'none',
                                background: 'transparent',
                                border: 'none',
                                fontSize: 13,
                                fontWeight: 500,
                                color: targetProfileId ? SENSOR_COLORS.btTargetStrong : 'var(--color-muted)',
                                cursor: charged ? 'default' : 'pointer',
                                paddingRight: 16,
                                letterSpacing: '0.14px',
                                outline: 'none',
                            }}
                        >
                            <option value="">No Target</option>
                            {roastProfiles.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                        {!charged && (
                            <ChevronDown
                                size={12}
                                style={{
                                    position: 'absolute',
                                    right: 0,
                                    pointerEvents: 'none',
                                    color: SENSOR_COLORS.btTarget,
                                }}
                            />
                        )}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ textAlign: 'right' }}>
                    <div
                        style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 44,
                            fontWeight: 600,
                            color: 'var(--color-primary)',
                            letterSpacing: '-2px',
                            lineHeight: 1,
                            marginBottom: 4,
                        }}
                    >
                        {timeStr}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                        {phase} phase
                    </div>
                </div>
                {onOpenRoastSettings && (
                    <button
                        onClick={onOpenRoastSettings}
                        aria-label="Open roast settings"
                        title="Roast settings"
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            border: 'none',
                            background: 'var(--color-surface)',
                            color: 'var(--color-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                            boxShadow: 'var(--shadow-inset)',
                            marginTop: 6,
                        }}
                    >
                        <Settings2 size={15} strokeWidth={1.9} />
                    </button>
                )}
            </div>
        </div>
    );
};
