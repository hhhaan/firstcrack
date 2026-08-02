import type { Machine, RoasterDef } from '@entities/machine';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Cpu, ShieldCheck, X } from 'lucide-react';
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
            {/* Header */}
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm border-b border-black/4 dark:border-[#585d61] px-7 pt-5.5 pb-4.5 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-[14px] bg-primary dark:bg-black flex items-center justify-center text-white shrink-0">
                        <Cpu size={20} strokeWidth={1.8} />
                    </div>
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/80 dark:bg-surface-elevated text-secondary text-[11px] font-semibold tracking-[0.1px] mb-2.5 shadow-(--shadow-inset)">
                            <ShieldCheck size={13} strokeWidth={1.9} className="dark:!text-[#a3a3a3]" />
                            {form.isEdit ? t('addMachine.connectionSettings') : t('addMachine.onboarding')}
                        </div>
                        <h2
                            id="add-machine-modal-title"
                            className="font-(--font-display) text-[26px] font-normal tracking-[-0.04em] text-primary m-0"
                        >
                            {form.isEdit ? t('addMachine.editTitle') : t('addMachine.title')}
                        </h2>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void form.handleClose()}
                    aria-label={t('common.close')}
                    className="w-[34px] h-[34px] rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted dark:!text-[#8a8580] flex items-center justify-center cursor-pointer shrink-0 shadow-(--shadow-inset) transition-colors hover:text-primary dark:hover:!text-[#e5e5e5]"
                >
                    <X size={16} strokeWidth={2.3} />
                </button>
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
