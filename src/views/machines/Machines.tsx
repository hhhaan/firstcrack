import type { Machine } from '@entities/machine';
import { useMachines, VIRTUAL_ID } from '@entities/machine';
import { syncW60aDoorSettings } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useMachineSidecarConnection } from '@features/machine-connection';
import type { View } from '@shared/types/view';
import { Badge } from '@shared/ui/Badge';
import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { useMachinesPageState } from '@widgets/add-machine-modal/model/useMachinesPageState';
import { AddMachineModal } from '@widgets/add-machine-modal/ui/AddMachineModal';
import { Activity, AlertCircle, Cpu, Flame, Pencil, Plus, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { disconnectMachineWithRoastGuard } from './lib/roastDisconnectConfirm';
import { MachineConnectionDetails } from './ui/MachineConnectionDetails';

export const Machines = ({
    isActive = false,
    onNavigate,
}: {
    isActive?: boolean;
    onNavigate?: (view: View) => void;
}) => {
    const { t } = useTranslation();
    const { machines, removeMachine } = useMachines();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    /** Bridges page-state modalOpen into sidecar poll gate (hook order). */
    const [modalOpenForPoll, setModalOpenForPoll] = useState(false);

    const {
        sidecarStatus,
        setSidecarStatus,
        temps,
        setTemps,
        connecting,
        sidecarReady,
        handleConnect: connectMachine,
        handleDisconnect,
    } = useMachineSidecarConnection({
        isActive,
        modalOpen: modalOpenForPoll,
        machines,
        onConnectedMachineId: setSelectedId,
    });

    const {
        modalOpen,
        editingMachine,
        openAddModal,
        openEditModal,
        closeModal,
        handleAdd,
        handleEdit,
        isThisMachineConnected,
        allowAddMachine,
        maxMachines,
        realMachineCount,
        limitBlocked,
        dismissLimitBlocked,
    } = useMachinesPageState({ sidecarStatus, setSidecarStatus, setTemps });

    useEffect(() => {
        setModalOpenForPoll(modalOpen);
    }, [modalOpen]);

    const selected = machines.find((m) => m.id === selectedId) ?? null;

    const handleConnect = async (machine: Machine) => {
        const status = await connectMachine(machine);
        if (status?.connected) {
            syncW60aDoorSettings();
            const { phase, enterPreheating, setConnected } = useRoastingStore.getState();
            if (phase === 'idle' || phase === 'ended') {
                enterPreheating(status.capabilities);
            } else {
                setConnected(true, status.capabilities);
            }
        }
    };

    const connectedMachine = machines.find(isThisMachineConnected);

    const isSelectedConnected = selected ? isThisMachineConnected(selected) : false;

    return (
        <PageLayout>
            <AddMachineModal
                key={editingMachine?.id ?? 'new'}
                open={modalOpen}
                onClose={closeModal}
                onAdd={handleAdd}
                editing={editingMachine}
                onEdit={handleEdit}
            />

            <PageHeader
                title={t('machines.title')}
                subtitle={`${t('machines.registered', { count: machines.length })}${
                    sidecarStatus?.connected && connectedMachine
                        ? ` · ${t('machines.connectedSuffix', { name: connectedMachine.name })}`
                        : ` · ${t('machines.noActiveConnection')}`
                }`}
                actions={
                    <PillButton onClick={openAddModal}>
                        <Plus size={15} strokeWidth={2.5} />
                        {t('machines.addMachine')}
                    </PillButton>
                }
            />

            {!allowAddMachine && maxMachines != null ? (
                <div className="mb-3 rounded-lg border border-border-subtle bg-surface/60 px-4 py-2.5 text-[12px] text-secondary dark:border-[#585d61]">
                    {t('machines.limit.banner', { max: maxMachines, used: realMachineCount })}
                </div>
            ) : null}

            {limitBlocked ? (
                <ModalShell onClose={dismissLimitBlocked} labelledBy="machine-limit-title">
                    <div className="w-full max-w-md rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-[#585d61]">
                        <h2 id="machine-limit-title" className="mb-2 text-base font-semibold text-primary">
                            {t('machines.limit.title')}
                        </h2>
                        <p className="mb-4 text-[13px] leading-relaxed text-muted">
                            {t('machines.limit.description', { max: maxMachines ?? 1 })}
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={dismissLimitBlocked}
                                className="rounded-full border border-border-subtle px-4 py-2 text-xs dark:border-[#585d61]"
                            >
                                {t('common.close', { defaultValue: 'Close' })}
                            </button>
                        </div>
                    </div>
                </ModalShell>
            ) : null}

            {machines.length === 0 ? (
                <div className="bg-main-bg rounded-lg py-16 px-8 text-center dark:border dark:border-[#585d61]">
                    <Cpu size={32} strokeWidth={1.2} color="var(--color-muted)" className="mb-4 mx-auto" />
                    <p className="text-[15px] text-muted mb-5">{t('machines.empty')}</p>
                    <button
                        type="button"
                        onClick={openAddModal}
                        className="px-5 py-2.5 rounded-[10px] border-none bg-primary dark:bg-[#0d0d0d] text-white text-[13px] font-medium cursor-pointer"
                    >
                        {t('machines.addFirst')}
                    </button>
                </div>
            ) : (
                <MasterDetailLayout
                    left={
                        <div className="flex flex-col gap-2">
                            {machines.map((machine) => {
                                const isConnected = isThisMachineConnected(machine);
                                return (
                                    <div
                                        key={machine.id}
                                        onClick={() => setSelectedId(machine.id)}
                                        className={`bg-main-bg rounded-lg px-4 py-3.5 cursor-pointer transition-all duration-150 dark:border dark:border-[#585d61]`}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div>
                                                <div className="text-[13px] font-medium text-primary mb-0.5">
                                                    {machine.name}
                                                </div>
                                                <div className="text-[12px] text-muted">{machine.displayName}</div>
                                            </div>
                                            <Badge
                                                size="sm"
                                                uppercase
                                                tone={isConnected ? 'good' : 'bad'}
                                                className="px-1.75"
                                            >
                                                {isConnected ? 'Live' : 'Offline'}
                                            </Badge>
                                        </div>
                                        <div className="flex gap-2.5">
                                            <span className="text-[11px] text-muted flex items-center gap-0.75">
                                                <Activity size={11} /> {machine.protocol.toUpperCase()}
                                            </span>
                                            <span className="text-[11px] text-muted">{machine.brand}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    }
                    detail={
                        selected ? (
                            <div className="bg-main-bg rounded-lg px-8 py-7 h-fit dark:border dark:border-[#585d61]">
                                <div className="flex items-start justify-between mb-6">
                                    <div>
                                        <h2 className="font-display font-light text-[26px] leading-[1.2] text-primary tracking-[-0.3px] mb-2">
                                            {selected.name}
                                        </h2>
                                        <div className="flex gap-2.5 flex-wrap">
                                            {[
                                                selected.brand,
                                                selected.protocol.toUpperCase(),
                                                ...selected.capabilities,
                                            ].map((tag) => (
                                                <Badge key={tag} tone="neutral" className="px-2.25 font-semibold">
                                                    {tag}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {selected.id !== VIRTUAL_ID && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => openEditModal(selected)}
                                                    className="w-9 h-9 rounded-[10px] border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer"
                                                    title={t('machines.editMachine')}
                                                >
                                                    <Pencil size={15} strokeWidth={2} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removeMachine(selected.id)}
                                                    className="w-9 h-9 rounded-[10px] border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer"
                                                    title={t('machines.removeMachine')}
                                                >
                                                    <Trash2 size={15} strokeWidth={2} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Temperature cards — 항상 표시, 선택된 머신이 연결된 머신일 때만 실제 값 표시 */}
                                <div className="grid grid-cols-2 gap-3.5 mb-6">
                                    {[
                                        {
                                            label: t('machines.temperature.bean'),
                                            value: isSelectedConnected && temps?.bt != null ? `${temps.bt}°C` : '—',
                                            sub: 'BT',
                                        },
                                        {
                                            label: t('machines.temperature.environment'),
                                            value: isSelectedConnected && temps?.et != null ? `${temps.et}°C` : '—',
                                            sub: 'ET',
                                        },
                                        ...(isSelectedConnected ? (temps?.extra_readings ?? []) : []).map(
                                            (reading) => ({
                                                label: reading.label,
                                                value:
                                                    reading.value != null
                                                        ? `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}`
                                                        : '—',
                                                sub: reading.id,
                                            }),
                                        ),
                                    ].map((s) => (
                                        <div
                                            key={s.sub}
                                            className="bg-surface dark:bg-surface-elevated px-4 py-3.5 rounded-lg"
                                        >
                                            <div className="text-[10px] font-semibold text-muted uppercase tracking-[0.5px] mb-1.5">
                                                {s.label}
                                            </div>
                                            <div className="text-[22px] font-light text-primary tracking-[-0.3px] whitespace-nowrap tabular-nums">
                                                {s.value}
                                            </div>
                                            <div className="text-[11px] text-muted mt-0.5">{s.sub}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Connection params */}
                                {Object.keys(selected.connectionParams).length > 0 && (
                                    <MachineConnectionDetails machine={selected} />
                                )}

                                {sidecarStatus?.error && sidecarStatus.roaster === selected.roasterKey && (
                                    // TODO: 에러 메시지 하단에 "문의하기" 링크 추가 (예: 이메일 or 카카오 채널)
                                    <div className="flex items-center gap-2 bg-[rgba(192,57,43,0.07)] rounded-lg px-3.5 py-2.5 mb-4 text-[12px] text-[#c0392b]">
                                        <AlertCircle size={14} />
                                        {sidecarStatus.error}
                                    </div>
                                )}

                                {/* Connect / Disconnect */}
                                <div className="flex gap-2.5">
                                    {isSelectedConnected ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const { phase, machineSnapshot } = useRoastingStore.getState();
                                                void disconnectMachineWithRoastGuard({
                                                    session: { phase, machineSnapshot },
                                                    machine: { id: selected.id, roasterKey: selected.roasterKey },
                                                    disconnect: handleDisconnect,
                                                });
                                            }}
                                            className="py-3 px-5 rounded-lg border-none bg-surface dark:bg-surface-elevated text-secondary text-sm font-medium cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            <WifiOff size={15} strokeWidth={2} />
                                            {t('machines.disconnect')}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleConnect(selected)}
                                            disabled={connecting || !sidecarReady}
                                            className={`flex-1 py-3 rounded-lg border-none bg-primary dark:bg-[#0d0d0d] text-white text-sm font-medium flex items-center justify-center gap-2 ${
                                                connecting || !sidecarReady
                                                    ? 'opacity-70 cursor-default'
                                                    : 'cursor-pointer'
                                            }`}
                                        >
                                            {!sidecarReady ? (
                                                <>
                                                    <Activity size={15} /> {t('machines.sidecarStarting')}
                                                </>
                                            ) : connecting ? (
                                                <>
                                                    <Activity size={15} /> {t('common.connecting')}
                                                </>
                                            ) : (
                                                <>
                                                    <Wifi size={15} strokeWidth={2} /> {t('machines.connect')}
                                                </>
                                            )}
                                        </button>
                                    )}
                                    {isSelectedConnected && onNavigate && (
                                        <button
                                            type="button"
                                            onClick={() => onNavigate('roast')}
                                            className="flex-1 py-3 rounded-lg border-none bg-primary dark:bg-[#0d0d0d] text-white text-sm font-semibold cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            <Flame size={15} strokeWidth={2} />
                                            {t('machines.startRoasting')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : null
                    }
                    placeholder={t('machines.selectMachine')}
                />
            )}
        </PageLayout>
    );
};
