import type { Machine, RoasterDef } from '@entities/machine';
import { modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Cpu, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAddMachineForm } from '../model/useAddMachineForm';
import { ConfirmStepFooter } from './ConfirmStepFooter';
import { ConnectionMethodSection } from './ConnectionMethodSection';
import { ControlSettingsSection } from './ControlSettingsSection';
import { DriverSettingsSection } from './DriverSettingsSection';

interface AddMachineModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (
        roasterKey: string,
        def: RoasterDef,
        params: Record<string, unknown>,
        meta?: { name?: string; brand?: string },
    ) => void;
    editing?: Machine | null;
    onEdit?: (id: string, params: Record<string, unknown>, keepConnection?: boolean) => Promise<void>;
}

export const AddMachineModal = ({ open, onClose, onAdd, editing, onEdit }: AddMachineModalProps) => {
    const { t } = useTranslation();
    const form = useAddMachineForm({ open, onClose, onAdd, editing, onEdit });

    if (!open) return null;

    return (
        <ModalShell
            onClose={form.handleClose}
            labelledBy="add-machine-modal-title"
            contentClassName={modalPanel.formLg}
        >
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="add-machine-modal-title"
                    title={
                        <>
                            <span className="mb-2.5 flex">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold tracking-[0.1px] text-secondary shadow-(--shadow-inset) dark:bg-surface-elevated">
                                    <ShieldCheck size={13} strokeWidth={1.9} className="dark:!text-[#a3a3a3]" />
                                    {form.isEdit ? t('addMachine.connectionSettings') : t('addMachine.onboarding')}
                                </span>
                            </span>
                            {form.isEdit ? t('addMachine.editTitle') : t('addMachine.title')}
                        </>
                    }
                    onClose={() => void form.handleClose()}
                    closeLabel={t('common.close')}
                    className="items-start gap-4 px-7 pt-5.5 pb-4.5"
                    titleClassName="font-(--font-display) text-[26px] font-normal tracking-[-0.04em] text-primary m-0"
                    leading={
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-primary text-white dark:bg-black">
                            <Cpu size={20} strokeWidth={1.8} />
                        </div>
                    }
                />
            </div>

            {/* Body */}
            <ModalScrollBody contentClassName="px-7 py-6 flex flex-col gap-5">
                <ConnectionMethodSection
                    isEdit={form.isEdit}
                    isCustom={form.isCustom}
                    tab={form.tab}
                    switchTab={form.switchTab}
                    selectedKey={form.selectedKey}
                    selectRoaster={form.selectRoaster}
                    customName={form.customName}
                    setCustomName={form.setCustomName}
                    customBrand={form.customBrand}
                    setCustomBrand={form.setCustomBrand}
                    customProtocol={form.customProtocol}
                    selectCustomProtocol={form.selectCustomProtocol}
                />

                <DriverSettingsSection
                    selectedDef={form.selectedDef}
                    isCustom={form.isCustom}
                    params={form.params}
                    setParam={form.setParam}
                    serialPorts={form.serialPorts}
                    onRefreshPorts={form.refreshSerialPorts}
                    networkHosts={form.networkHosts}
                    scanningNetwork={form.scanningNetwork}
                    scannedNetworkOnce={form.scannedNetworkOnce}
                    onScanNetwork={form.scanNetworkHosts}
                    showAddressMap={form.showAddressMap}
                    addressFields={form.addressFields}
                />

                {form.showWriteMap && form.selectedDef && (
                    <ControlSettingsSection
                        protocol={form.selectedDef.protocol}
                        params={form.params}
                        setParam={form.setParam}
                        serialPorts={form.serialPorts}
                    />
                )}

                {form.error && (
                    <div className="text-[13px] text-red-600 dark:text-red-400 px-3 py-2 rounded-lg bg-red-500/8 dark:bg-red-500/10">
                        {form.error}
                    </div>
                )}
            </ModalScrollBody>

            <ConfirmStepFooter
                isEdit={form.isEdit}
                testState={form.testState}
                testMessage={form.testMessage}
                canCommit={form.canCommit}
                saving={form.saving}
                successActions={form.successActions}
                onTest={() => void form.handleTestConnection()}
                onClose={() => void form.handleClose()}
                onCommit={(action) => void form.commit(action)}
            />
        </ModalShell>
    );
};
