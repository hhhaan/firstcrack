import type { Machine, RoasterDef } from '@entities/machine';
import { canConnectRoaster } from '@entities/machine';
import {
    beginMachineConnectAttempt,
    endMachineConnectAttempt,
    noteUserMachineDisconnect,
    settleUserMachineDisconnect,
} from '@features/machine-connection/lib/machineLinkNotice';
import { useAccountPlan } from '@shared/lib/features/useAccountPlan';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assembleConnectionParams } from './assembleConnectionParams';
import type { CommitAction, ConnectionTest, SuccessActions } from './types';

type Args = {
    isEdit: boolean;
    isCustom: boolean;
    selectedDef: RoasterDef | null;
    connectKey: string;
    customName: string;
    customBrand: string;
    params: Record<string, string>;
    showAddressMap: boolean;
    includeWriteMap: boolean;
    editing: Machine | null | undefined;
    onEdit?: (id: string, params: Record<string, unknown>, keepConnection?: boolean) => Promise<void>;
    onAdd: (
        roasterKey: string,
        def: RoasterDef,
        params: Record<string, unknown>,
        meta?: { id?: string; name?: string; brand?: string },
    ) => void;
    onClose: () => void;
    testConnectedRef: { current: boolean };
    setSaving: (v: boolean) => void;
    setError: (v: string) => void;
    setConnectionTest: (value: ConnectionTest) => void;
};

export const useMachineFormActions = ({
    isEdit,
    isCustom,
    selectedDef,
    connectKey,
    customName,
    customBrand,
    params,
    showAddressMap,
    includeWriteMap,
    editing,
    onEdit,
    onAdd,
    onClose,
    testConnectedRef,
    setSaving,
    setError,
    setConnectionTest,
}: Args) => {
    const { t } = useTranslation();
    const accountPlan = useAccountPlan();
    const [machineId, setMachineId] = useState(() => editing?.id ?? crypto.randomUUID());

    const commit = async (action: CommitAction) => {
        if (!selectedDef || !connectKey) return;
        if (isCustom && !isEdit && !customName.trim()) {
            setError(t('addMachine.fieldRequired', { field: t('addMachine.customName') }));
            return;
        }
        if (isCustom && !connectKey) {
            setError(t('addMachine.fieldRequired', { field: t('addMachine.protocol') }));
            return;
        }

        const assembled = assembleConnectionParams(
            selectedDef,
            params,
            showAddressMap,
            includeWriteMap,
            editing?.protocol === selectedDef.protocol ? editing.connectionParams : undefined,
        );
        if (!assembled.ok) {
            setError(
                assembled.invalid
                    ? t('addMachine.invalidAddress', { field: assembled.invalid })
                    : t('addMachine.fieldRequired', { field: assembled.missing }),
            );
            return;
        }

        const keepTest = action === 'addAndConnect' || action === 'saveAndConnect';
        const isSave = action === 'save' || action === 'saveAndConnect';
        if (isSave && (!editing || !onEdit)) return;

        setSaving(true);
        setError('');
        try {
            if (!keepTest && testConnectedRef.current) {
                noteUserMachineDisconnect();
                const status = await sidecar.disconnect().catch(() => null);
                settleUserMachineDisconnect(status?.connected === false);
                testConnectedRef.current = false;
            }
            if (isSave) {
                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                await onEdit!(editing!.id, assembled.typed, keepTest);
            } else {
                onAdd(connectKey, selectedDef, assembled.typed, {
                    id: machineId,
                    ...(isCustom ? { name: customName.trim(), brand: customBrand.trim() || 'Custom' } : {}),
                });
                if (action === 'addAndConnect') testConnectedRef.current = false;
                setMachineId(crypto.randomUUID());
            }
            if (!keepTest) onClose();
        } catch (err) {
            logger.capture(err, { scope: 'machineForm.commit' });
            setError(t(isEdit ? 'addMachine.failedToSave' : 'addMachine.failedToAdd'));
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        if (!connectKey || !selectedDef) return;
        if (isCustom && !connectKey) {
            setError(t('addMachine.fieldRequired', { field: t('addMachine.protocol') }));
            return;
        }

        const assembled = assembleConnectionParams(
            selectedDef,
            params,
            showAddressMap,
            includeWriteMap,
            editing?.protocol === selectedDef.protocol ? editing.connectionParams : undefined,
        );
        if (!assembled.ok) {
            setError(
                assembled.invalid
                    ? t('addMachine.invalidAddress', { field: assembled.invalid })
                    : t('addMachine.fieldRequired', { field: assembled.missing }),
            );
            return;
        }

        if (testConnectedRef.current) {
            noteUserMachineDisconnect();
            const status = await sidecar.disconnect().catch(() => null);
            settleUserMachineDisconnect(status?.connected === false);
            testConnectedRef.current = false;
        }

        if (!canConnectRoaster(connectKey, accountPlan)) {
            setConnectionTest({ status: 'failed', message: t('machines.enterpriseOnly') });
            return;
        }

        setConnectionTest({ status: 'testing' });
        setError('');

        let connected = false;
        beginMachineConnectAttempt();
        try {
            const status = await sidecar.connect(connectKey, assembled.typed, machineId);
            connected = status.connected;
            if (status.connected) {
                const temps = await sidecar.getTemperatures().catch(() => null);
                setConnectionTest({
                    status: 'success',
                    message:
                        temps?.bt != null ? t('addMachine.connectedWithBt', { bt: temps.bt }) : t('common.connected'),
                });
                testConnectedRef.current = true;
            } else {
                setConnectionTest({ status: 'failed', message: status.error ?? t('addMachine.connectionFailed') });
            }
        } catch (e) {
            // 타임아웃 후에도 사이드카가 핸드셰이크를 쥐고 있으면 다음 시도가 락에 막힌다
            void sidecar.disconnect().catch(() => null);
            setConnectionTest({
                status: 'failed',
                message: e instanceof Error ? e.message : t('addMachine.connectionFailed'),
            });
        } finally {
            endMachineConnectAttempt(connected);
        }
    };

    const successActions: SuccessActions = useMemo(
        () =>
            isEdit
                ? {
                      secondary: { action: 'save', label: t('addMachine.saveOnly') },
                      primary: {
                          action: 'saveAndConnect',
                          label: t('addMachine.saveAndConnect'),
                          loading: t('addMachine.saving'),
                      },
                  }
                : {
                      secondary: { action: 'add', label: t('addMachine.addOnly') },
                      primary: {
                          action: 'addAndConnect',
                          label: t('addMachine.addAndConnect'),
                          loading: t('addMachine.adding'),
                      },
                  },
        [isEdit, t],
    );

    return { commit, handleTestConnection, successActions };
};
