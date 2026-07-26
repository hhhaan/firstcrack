import { useBeans } from '@entities/bean';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastProfiles } from '@entities/roast-profile';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { FormSelect } from '@shared/ui/FormSelect';
import {
    labelCls,
    modalCancelBtnCls,
    modalFooterChrome,
    modalHeaderChrome,
    modalPrimaryBtnCls,
} from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Props = {
    open: boolean;
    selectedBeanId: string | null;
    targetProfileId: string | null;
    onBeanChange: (id: string | null) => void;
    onProfileChange: (id: string | null) => void;
    onClose: () => void;
    /** Called once a bean is picked — resumes the charge the user asked for. */
    onConfirm: () => void;
};

/**
 * Charge gate: a session saved without a bean cannot deduct stock, so the bean is
 * required here. The target profile stays optional (roasting without a target curve
 * is legitimate).
 */
export const PreChargeSelectionModal = ({
    open,
    selectedBeanId,
    targetProfileId,
    onBeanChange,
    onProfileChange,
    onClose,
    onConfirm,
}: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: beans = [] } = useBeans(workspaceOwnerId);
    const { data: profiles = [] } = useRoastProfiles(workspaceOwnerId);

    useFormEscape(open, onClose);

    if (!open) return null;

    return (
        <ModalShell onClose={onClose} labelledBy="pre-charge-selection-title" contentClassName={modalPanel.formSm}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="pre-charge-selection-title"
                    title={t('activeRoast.preCharge.title')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-4">
                <div className="flex gap-2.5 rounded-xl bg-surface-warm-solid px-3.5 py-3 dark:bg-surface-elevated">
                    <Info size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-muted" />
                    <p className="text-[12px] leading-relaxed text-muted tracking-[0.14px]">
                        {t('activeRoast.preCharge.description')}
                    </p>
                </div>

                <div>
                    <label className={labelCls} htmlFor="pre-charge-bean">
                        {t('activeRoast.preCharge.bean')}
                    </label>
                    <FormSelect
                        id="pre-charge-bean"
                        value={selectedBeanId ?? ''}
                        onChange={(e) => onBeanChange(e.target.value || null)}
                    >
                        <option value="">{t('activeRoast.preCharge.beanPlaceholder')}</option>
                        {beans.map((bean) => (
                            <option key={bean.id} value={bean.id}>
                                {bean.name}
                            </option>
                        ))}
                    </FormSelect>
                </div>

                <div>
                    <label className={labelCls} htmlFor="pre-charge-profile">
                        {t('activeRoast.preCharge.profile')}
                    </label>
                    <FormSelect
                        id="pre-charge-profile"
                        value={targetProfileId ?? ''}
                        onChange={(e) => onProfileChange(e.target.value || null)}
                    >
                        <option value="">{t('activeRoast.preCharge.profilePlaceholder')}</option>
                        {profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                                {profile.name}
                            </option>
                        ))}
                    </FormSelect>
                </div>
            </ModalScrollBody>

            <div className={modalFooterChrome}>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('common.cancel')}
                    </button>
                    <button type="button" disabled={!selectedBeanId} onClick={onConfirm} className={modalPrimaryBtnCls}>
                        {t('activeRoast.actions.charge')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
