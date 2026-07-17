import { ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fmtDate, fmtDuration } from '../lib/format';

type SessionOption = {
    id: string;
    beans?: { name?: string | null } | null;
    roasted_at: string | null;
    drop_temp_celsius: number | null;
    duration_seconds: number | null;
    roast_level: string | null;
};

type ProfileSessionPickerProps = {
    sessions: SessionOption[];
    onSelect: (sessionId: string) => void;
    onBack: () => void;
    onClose: () => void;
};

export const ProfileSessionPicker = ({ sessions, onSelect, onBack, onClose }: ProfileSessionPickerProps) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <button
                            type="button"
                            onClick={onBack}
                            className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                        >
                            <ChevronRight size={14} strokeWidth={2.5} className="rotate-180" />
                        </button>
                        <h2 className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0">
                            {t('newProfileModal.selectSession')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            <div className="px-8 py-6 overflow-y-auto flex-1">
                {sessions.length === 0 ? (
                    <p className="text-sm text-muted text-center py-8">{t('newProfileModal.noSessions')}</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {sessions.map((session) => (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => onSelect(session.id)}
                                className="w-full px-4 py-3 rounded-xl border border-black/6 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-left cursor-pointer hover:bg-white/90 dark:hover:bg-[#262b31] transition-all duration-200 group"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-sm font-semibold text-primary">
                                            {session.beans?.name ?? t('newProfileModal.unknownBean')}
                                        </span>
                                        <span className="text-[12px] text-muted">
                                            {fmtDate(session.roasted_at)}
                                            {session.drop_temp_celsius != null &&
                                                ` · ${t('newProfileModal.drop')} ${session.drop_temp_celsius}°C`}
                                            {session.duration_seconds != null &&
                                                ` · ${fmtDuration(session.duration_seconds)}`}
                                            {session.roast_level && ` · ${session.roast_level}`}
                                        </span>
                                    </div>
                                    <ChevronRight
                                        size={16}
                                        strokeWidth={2}
                                        className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                                    />
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="px-8 pt-5 pb-8 bg-white/80 dark:bg-[#1a1e23] backdrop-blur-sm border-t border-black/4 dark:border-[#585d61] shrink-0">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                >
                    {t('newProfileModal.cancel')}
                </button>
            </div>
        </div>
    );
};
