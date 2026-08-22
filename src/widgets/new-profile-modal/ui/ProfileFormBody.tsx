import { formatDuration } from '@shared/lib/format';
import type { Bean } from '@shared/types/database.types';
import { FormSelect } from '@shared/ui/FormSelect';
import {
    inputCls,
    labelCls,
    modalCancelBtnCls,
    modalFooterChrome,
    modalHeaderChrome,
    modalPrimaryBtnCls,
} from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { Check, ChevronRight, History, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '../lib/format';
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
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="new-profile-modal-title"
                    title={
                        isEditing
                            ? t('newProfileModal.editTitle')
                            : mode === 'from-session'
                              ? t('newProfileModal.fromSession')
                              : t('newProfileModal.newTitle')
                    }
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-4"
                    leading={
                        <button
                            type="button"
                            onClick={onBackToPick}
                            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl border-none bg-surface text-muted transition-all duration-200 hover:text-primary dark:bg-surface-elevated"
                        >
                            <ChevronRight size={14} strokeWidth={2.5} className="rotate-180" />
                        </button>
                    }
                />

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
                                    ` · ${formatDuration(selectedSession.duration_seconds)}`}
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

            <div className={modalFooterChrome}>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('newProfileModal.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid}
                        className={`${modalPrimaryBtnCls} flex items-center justify-center gap-2`}
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
