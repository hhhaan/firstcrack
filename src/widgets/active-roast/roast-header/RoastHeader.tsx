import { Settings2, ChevronDown } from 'lucide-react';
import { roastProfiles, DEFAULT_PROFILE_KEY } from '@shared/data/roast-profiles';
import { useRoastingStore } from '@features/active-roast/model/status';
import { STATUS_COLORS, PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';
import { useBeans } from '@entities/bean/queries';
import { useAuthStore } from '@shared/store/auth';

export const RoastHeader = ({
    phase,
    targetProfileId,
    selectedBeanId,
    onTargetProfileChange,
    onBeanChange,
    onOpenRoastSettings,
}: {
    phase: string;
    targetProfileId: number | null;
    selectedBeanId: string | null;
    onTargetProfileChange: (id: number | null) => void;
    onBeanChange: (id: string | null) => void;
    onOpenRoastSettings?: () => void;
}) => {
    const roastEnded = useRoastingStore((s) => s.phase === 'ended');
    const charged = useRoastingStore((s) => s.charged);
    const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
    const elapsed = useRoastingStore((s) => s.elapsed);
    const user = useAuthStore((s) => s.user);
    const { data: beans = [] } = useBeans(user?.id ?? '');

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

    const handleBeanChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        onBeanChange(val === '' ? null : val);
        if (val) localStorage.setItem('fc_default_bean_id', val);
        else localStorage.removeItem('fc_default_bean_id');
    };

    const isDisconnected = roastEnded || !sidecarConnected;
    const canPulse = sidecarConnected && charged && !roastEnded;
    const statusColor = isDisconnected ? '#6b7280' : PHASE_COLORS.ready;
    const dotStyle = {
        background: isDisconnected ? '#6b7280' : STATUS_COLORS.active,
        boxShadow: canPulse ? `0 0 0 3px ${STATUS_COLORS.activeGlow}` : 'none',
        animation: canPulse ? 'pulse 2s infinite' : 'none',
    };

    const statusText = roastEnded
        ? 'Roast Complete'
        : !sidecarConnected
          ? charged
              ? 'Mock — Roast in Progress'
              : 'Disconnected'
          : !charged
            ? 'Machine Connected · Ready to Roast'
            : 'Live — Roast in Progress';

    const selectedBean = beans.find((b) => b.id === selectedBeanId);
    const beanDetails = [selectedBean?.process, selectedBean?.region, selectedBean?.origin].filter(Boolean).join(' · ');

    return (
        <div className="flex items-end justify-between mb-7">
            <div>
                <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-2 h-2 rounded-full" style={dotStyle} />
                    <span className="text-xs font-normal tracking-[0.5px] uppercase" style={{ color: statusColor }}>
                        {statusText}
                    </span>
                </div>

                <div className="relative inline-flex items-center mb-1.5">
                    <select
                        value={selectedBeanId ?? ''}
                        onChange={handleBeanChange}
                        disabled={charged}
                        className={`appearance-none bg-transparent border-none font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] outline-none pr-7 ${charged ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                        <option value="" style={{ fontSize: '14px' }}>
                            No Bean Selected
                        </option>
                        {beans.map((b) => (
                            <option key={b.id} value={b.id} style={{ fontSize: '14px' }}>
                                {b.name}
                            </option>
                        ))}
                    </select>
                    {!charged && <ChevronDown size={18} className="absolute right-0 pointer-events-none text-muted" />}
                </div>

                <div className="flex items-center gap-1.5">
                    <span className="text-[13px] text-muted tracking-[0.14px]">
                        {beanDetails ? `${beanDetails} · Target:` : 'Target:'}
                    </span>
                    <div className="relative inline-flex items-center">
                        <select
                            value={targetProfileId ?? ''}
                            onChange={handleProfileChange}
                            disabled={charged}
                            className={`appearance-none bg-transparent border-none text-[13px] font-medium pr-4 tracking-[0.14px] outline-none ${charged ? 'cursor-default' : 'cursor-pointer'}`}
                            style={{ color: targetProfileId ? SENSOR_COLORS.btTargetStrong : 'var(--color-muted)' }}
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
                                className="absolute right-0 pointer-events-none"
                                style={{ color: SENSOR_COLORS.btTarget }}
                            />
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-start gap-3">
                <div className="text-right">
                    <div className="font-mono text-[44px] font-semibold text-primary tracking-[-2px] leading-none mb-1">
                        {timeStr}
                    </div>
                    <div className="text-[13px] text-muted tracking-[0.14px]">{phase} phase</div>
                </div>
                {onOpenRoastSettings && (
                    <button
                        onClick={onOpenRoastSettings}
                        aria-label="Open roast settings"
                        title="Roast settings"
                        className="w-8.5 h-8.5 rounded-[10px] border-none bg-surface text-muted flex items-center justify-center cursor-pointer shrink-0 mt-1.5"
                        style={{ boxShadow: 'var(--shadow-inset)' }}
                    >
                        <Settings2 size={15} strokeWidth={1.9} />
                    </button>
                )}
            </div>
        </div>
    );
};
