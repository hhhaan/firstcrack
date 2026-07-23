import type { Bean } from '@shared/types/database.types';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { Check, ChevronRight, History, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fmtDate, fmtDuration } from '../lib/format';
import { type ProfileDefaultType, type ProfileFormMode, type ProfileFormState, ROAST_LEVELS } from '../lib/types';
import { ProfileCurveFields } from './ProfileCurveFields';
import { ProfileDefaultSourceFields } from './ProfileDefaultSourceFields';

type SessionSummary = {
    beans?: { name?: string | null } | null;
    roasted_at: string | null;
    duration_seconds: number | null;
};

type BlendOption = { id: string; name: string };

type ProfileFormBodyProps = {
    mode: ProfileFormMode;
    form: ProfileFormState;
    setField: (
        field: keyof ProfileFormState,
    ) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    nameRef: React.RefObject<HTMLInputElement | null>;
    isEditing: boolean;
    isValid: boolean;
    selectedSession: SessionSummary | null;
    beans: Bean[];
    blends: BlendOption[];
    defaultType: ProfileDefaultType;
    setDefaultType: (t: ProfileDefaultType) => void;
    defaultBeanId: string | null;
    setDefaultBeanId: (id: string | null) => void;
    defaultBlendId: string | null;
    setDefaultBlendId: (id: string | null) => void;
    onBackToPick: () => void;
    onClose: () => void;
    onSubmit: (e: React.FormEvent) => void;
};

export const ProfileFormBody = ({
    mode,
    form,
    setField,
    nameRef,
    isEditing,
    isValid,
    selectedSession,
    beans,
    blends,
    defaultType,
    setDefaultType,
    defaultBeanId,
    setDefaultBeanId,
    defaultBlendId,
    setDefaultBlendId,
    onBackToPick,
    onClose,
    onSubmit,
}: ProfileFormBodyProps) => {
    const { t } = useTranslation();

    return (
        <form onSubmit={onSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <button
                            type="button"
                            onClick={onBackToPick}
                            className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                        >
                            <ChevronRight size={14} strokeWidth={2.5} className="rotate-180" />
                        </button>
                        <h2
                            id="new-profile-modal-title"
                            className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                        >
                            {isEditing
                                ? t('newProfileModal.editTitle')
                                : mode === 'from-session'
                                  ? t('newProfileModal.fromSession')
                                  : t('newProfileModal.newTitle')}
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

                {mode === 'from-session' && selectedSession ? (
                    <div className="px-8 pb-4">
                        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface/60 dark:bg-surface-elevated border border-transparent dark:border-[#585d61] text-[12px] text-secondary shadow-(--shadow-inset)">
                            <History size={14} strokeWidth={2} className="text-muted flex-shrink-0" />
                            <span>
                                {t('newProfileModal.basedOn')}{' '}
                                <span className="font-medium text-primary">
                                    {selectedSession.beans?.name ?? t('newProfileModal.unknownBean')}
                                </span>
                                {' · '}
                                {fmtDate(selectedSession.roasted_at)}
                                {selectedSession.duration_seconds != null &&
                                    ` · ${fmtDuration(selectedSession.duration_seconds)}`}
                            </span>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="px-8 py-6 overflow-y-auto flex-1">
                <div className="flex flex-col gap-6">
                    <div>
                        <label className={labelCls}>
                            {t('newProfileModal.profileName')} <span className="text-red-400">*</span>
                        </label>
                        <input
                            ref={nameRef}
                            type="text"
                            value={form.name}
                            onChange={setField('name')}
                            placeholder={t('newProfileModal.profileNamePlaceholder')}
                            className={inputCls}
                        />
                    </div>

                    <div>
                        <label className={labelCls}>{t('newProfileModal.description')}</label>
                        <textarea
                            value={form.description}
                            onChange={setField('description')}
                            placeholder={t('newProfileModal.descriptionPlaceholder')}
                            rows={2}
                            className={`${inputCls} min-h-[56px] resize-none`}
                        />
                    </div>

                    <div>
                        <label className={labelCls}>{t('newProfileModal.targetLevel')}</label>
                        <FormSelect value={form.target_level} onChange={setField('target_level')}>
                            {ROAST_LEVELS.map((l) => (
                                <option key={l} value={l}>
                                    {t(`newProfileModal.roastLevel.${l}`)}
                                </option>
                            ))}
                        </FormSelect>
                    </div>

                    <ProfileCurveFields form={form} setField={setField} />

                    <ProfileDefaultSourceFields
                        beans={beans}
                        blends={blends}
                        defaultType={defaultType}
                        setDefaultType={setDefaultType}
                        defaultBeanId={defaultBeanId}
                        setDefaultBeanId={setDefaultBeanId}
                        defaultBlendId={defaultBlendId}
                        setDefaultBlendId={setDefaultBlendId}
                    />
                </div>
            </div>

            <div className="px-8 pt-5 pb-8 bg-white/80 dark:bg-[#1a1e23] backdrop-blur-sm border-t border-black/4 dark:border-[#585d61] shrink-0">
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                    >
                        {t('newProfileModal.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid}
                        className="flex-1 py-3.5 rounded-2xl border border-transparent dark:border-white bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isEditing ? (
                            <>
                                <Check size={16} strokeWidth={2.5} /> {t('newProfileModal.saveProfile')}
                            </>
                        ) : (
                            <>
                                <Plus size={16} strokeWidth={2.5} /> {t('newProfileModal.createProfile')}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </form>
    );
};
