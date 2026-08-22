import { modalCancelBtnCls, modalFooterChrome, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ChevronRight, History, Pencil } from 'lucide-react';
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
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="new-profile-modal-title"
                    title={t('newProfileModal.newTitle')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-4"
                />
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

            <div className={modalFooterChrome}>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('newProfileModal.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
};
