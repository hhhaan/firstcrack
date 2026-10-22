import type { Machine, RoasterDef } from '@entities/machine';
import { modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAddMachineForm } from '../model/useAddMachineForm';
import { ConfirmStepFooter } from './ConfirmStepFooter';
import { ConnectionMethodSection } from './ConnectionMethodSection';
import { DriverSettingsSection } from './DriverSettingsSection';

interface AddMachineModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (
        roasterKey: string,
        def: RoasterDef,
        params: Record<string, unknown>,
        meta?: { id?: string; name?: string; brand?: string },
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
            contentClassName={
                form.addressFields.length > 0
                    ? modalPanel.formXl
                    : form.selectedDef
                      ? modalPanel.formLg
                      : modalPanel.formSm
            }
        >
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="add-machine-modal-title"
                    title={form.isEdit ? t('addMachine.editTitle') : t('addMachine.title')}
                    onClose={() => void form.handleClose()}
                    closeLabel={t('common.close')}
                    className="gap-4 px-6 py-4"
                    titleClassName="font-(--font-display) text-[22px] font-normal tracking-[-0.04em] text-primary m-0"
                    leading={
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
                            <Cpu size={18} strokeWidth={1.8} />
                        </div>
                    }
                />
            </div>

            {/* Body */}
            <ModalScrollBody contentClassName="px-6 py-5 flex flex-col gap-4">
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

                {form.error && (
                    <div className="text-[13px] text-red-600 dark:text-red-400 px-3 py-2 rounded-lg bg-red-500/8 dark:bg-red-500/10">
                        {form.error}
                    </div>
                )}
            </ModalScrollBody>

            <ConfirmStepFooter
                isEdit={form.isEdit}
                connectionTest={form.connectionTest}
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
