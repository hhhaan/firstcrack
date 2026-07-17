import { ChevronRight, History, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProfileFormMode } from '../lib/types';

type ProfileModePickerProps = {
    onSelectMode: (mode: ProfileFormMode) => void;
    onClose: () => void;
};

export const ProfileModePicker = ({ onSelectMode, onClose }: ProfileModePickerProps) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <h2
                        id="new-profile-modal-title"
                        className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                    >
                        {t('newProfileModal.newTitle')}
                    </h2>
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
                <p className="text-sm text-secondary tracking-[0.14px] mb-4">{t('newProfileModal.howToCreate')}</p>

                <div className="flex flex-col gap-4">
                    <button
                        type="button"
                        onClick={() => onSelectMode('manual')}
                        className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated cursor-pointer transition-all text-left group hover:dark:bg-[#262b31]"
                    >
                        <div className="w-10 h-10 rounded-xl bg-surface dark:bg-[#262b31] flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                            <Pencil size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                                {t('newProfileModal.manualInput')}
                            </div>
                            <div className="text-[12px] text-muted tracking-[0.14px]">
                                {t('newProfileModal.manualInputDesc')}
                            </div>
                        </div>
                        <ChevronRight
                            size={16}
                            strokeWidth={2}
                            className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                    </button>

                    <button
                        type="button"
                        onClick={() => onSelectMode('session-list')}
                        className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated cursor-pointer transition-all text-left group hover:dark:bg-[#262b31]"
                    >
                        <div className="w-10 h-10 rounded-xl bg-surface dark:bg-[#262b31] flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                            <History size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                                {t('newProfileModal.fromSessionOption')}
                            </div>
                            <div className="text-[12px] text-muted tracking-[0.14px]">
                                {t('newProfileModal.fromSessionDesc')}
                            </div>
                        </div>
                        <ChevronRight
                            size={16}
                            strokeWidth={2}
                            className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                    </button>
                </div>
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
