import type { Machine, SidecarStatus, TemperatureReading } from '@entities/machine';
import { isSameSidecarStatus, useMachines, VIRTUAL_ID } from '@entities/machine';
import * as Sentry from '@sentry/react';
import { logger } from '@shared/lib/logger';
import { sendOsNotification } from '@shared/lib/osNotification';
import { sidecar } from '@shared/lib/sidecar';
import type { View } from '@shared/types/view';
import { Badge } from '@shared/ui/Badge';
import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { useMachinesPageState } from '@widgets/add-machine-modal/model/useMachinesPageState';
import { AddMachineModal } from '@widgets/add-machine-modal/ui/AddMachineModal';
import { Activity, AlertCircle, Cpu, Flame, Pencil, Plus, Search, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const POLL_INTERVAL_MS = 3000;

export const Machines = ({
    isActive = false,
    onNavigate,
}: {
    isActive?: boolean;
    onNavigate?: (view: View) => void;
}) => {
    const { t } = useTranslation();
    const { machines, removeMachine } = useMachines();
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);
    const [temps, setTemps] = useState<TemperatureReading | null>(null);
    const [connecting, setConnecting] = useState(false);

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

    // 마운트 시 & 모달 닫힐 때 status fetch — "Add & Connect" 흐름에서 연결 상태 즉시 반영
    useEffect(() => {
        if (!isActive) return;
        if (!modalOpen) {
            sidecar
                .getStatus()
                .then(setSidecarStatus)
                .catch(() => null);
        }
    }, [isActive, modalOpen]);

    useEffect(() => {
        if (!isActive || !sidecarStatus?.connected || modalOpen) {
            if (!sidecarStatus?.connected) setTemps(null);
            return;
        }

        const poll = async () => {
            const [nextTemps, nextStatus] = await Promise.all([
                sidecar.getTemperatures().catch(() => null),
                sidecar.getStatus().catch(() => null),
            ]);
            if (nextTemps) setTemps(nextTemps);
            if (nextStatus) {
                setSidecarStatus((prev) => (isSameSidecarStatus(prev, nextStatus) ? prev : nextStatus));
            }
        };
        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [isActive, sidecarStatus?.connected, modalOpen]);

    // 연결 상태가 바뀔 때만 자동 select — 사용자가 수동으로 다른 카드를 클릭할 수 있음
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (!sidecarStatus?.connected) return;
        const connectedId = machines.find((m) => m.roasterKey === sidecarStatus.roaster)?.id;
        if (connectedId) setSelectedId(connectedId);
        // selectedId 제외: 사용자 클릭 시 effect 재실행 방지
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sidecarStatus?.connected, sidecarStatus?.roaster]);

    const filtered = machines.filter(
        (m) =>
            m.name.toLowerCase().includes(search.toLowerCase()) || m.brand.toLowerCase().includes(search.toLowerCase()),
    );

    const selected = machines.find((m) => m.id === selectedId) ?? null;

    const handleConnect = async (machine: Machine) => {
        setConnecting(true);
        setSidecarStatus((prev) => (prev ? { ...prev, error: null } : prev));
        try {
            const status = await sidecar.connect(
                machine.roasterKey,
                machine.connectionParams as Record<string, unknown>,
            );
            setSidecarStatus(status);
            if (status.connected) {
                Sentry.addBreadcrumb({
                    category: 'hardware.connection',
                    message: `로스터 연결 성공: ${machine.name}`,
                    level: 'info',
                    data: { roasterKey: machine.roasterKey, protocol: machine.protocol },
                });
            } else if (status.error) {
                Sentry.addBreadcrumb({
                    category: 'hardware.connection',
                    message: `로스터 연결 실패: ${machine.name}`,
                    level: 'error',
                    data: { roasterKey: machine.roasterKey, protocol: machine.protocol, error: status.error },
                });
                Sentry.captureMessage(`로스터 연결 실패: ${machine.name} — ${status.error}`, 'warning');
                sendOsNotification(
                    '연결 실패',
                    `「${machine.name}」로스터에 연결할 수 없습니다. 연결 정보와 네트워크 상태를 확인해 주세요.`,
                );
            }
        } catch (e) {
            logger.capture(e, { context: 'machine connect' });
            Sentry.addBreadcrumb({
                category: 'hardware.connection',
                message: `로스터 연결 중 예외: ${machine.name}`,
                level: 'error',
                data: { roasterKey: machine.roasterKey, error: String(e) },
            });
            sendOsNotification(
                '연결 오류',
                `「${machine.name}」로스터 연결 중 문제가 발생했습니다. 사이드카 상태와 네트워크를 확인해 주세요.`,
            );
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        const prevStatus = sidecarStatus;
        const status = await sidecar.disconnect().catch(() => null);
        if (status) setSidecarStatus(status);
        setTemps(null);
        if (prevStatus?.connected) {
            Sentry.addBreadcrumb({
                category: 'hardware.connection',
                message: '로스터 연결 해제',
                level: 'info',
                data: {
                    prevRoaster: prevStatus.roaster,
                    uptimeSec: prevStatus.uptime,
                },
            });
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
                        <div>
                            <div className="flex items-center gap-2 bg-main-bg rounded-lg px-3 py-2.25 mb-2.5 dark:border dark:border-[#585d61]">
                                <Search size={14} strokeWidth={2} color="var(--color-muted)" />
                                <input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={t('machines.searchPlaceholder')}
                                    className="border-none bg-transparent outline-none text-[13px] text-primary font-body w-full tracking-[0.14px]"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                {filtered.map((machine) => {
                                    const isConnected = isThisMachineConnected(machine);
                                    return (
                                        <div
                                            key={machine.id}
                                            onClick={() => setSelectedId(machine.id)}
                                            className={`bg-main-bg rounded-lg px-4 py-3.5 cursor-pointer transition-all duration-150 border border-[#E5E5E5] dark:border-[#585d61]`}
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <div>
                                                    <div className="text-[13px] font-medium text-primary mb-0.5">
                                                        {machine.name}
                                                    </div>
                                                    <div className="text-[12px] text-muted)">{machine.displayName}</div>
                                                </div>
                                                <Badge
                                                    size="sm"
                                                    uppercase
                                                    tone={isConnected ? 'good' : 'bad'}
                                                    className="px-1.75"
                                                >
                                                    {isConnected ? t('common.live') : t('common.offline')}
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
                                <div className="grid grid-cols-3 gap-3.5 mb-6">
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
                                    ].map((s) => (
                                        <div
                                            key={s.label}
                                            className="bg-surface dark:bg-surface-elevated px-4 py-3.5 rounded-lg"
                                        >
                                            <div className="text-[10px] font-semibold text-muted uppercase tracking-[0.5px] mb-1.5">
                                                {s.label}
                                            </div>
                                            <div className="text-[22px] font-light text-primary tracking-[-0.3px]">
                                                {s.value}
                                            </div>
                                            <div className="text-[11px] text-muted mt-0.5">{s.sub}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Connection params */}
                                {Object.keys(selected.connectionParams).length > 0 && (
                                    <div className="bg-surface-warm-solid dark:bg-surface-elevated rounded-lg px-4.5 py-4 mb-6">
                                        <div className="text-[12px] font-semibold text-secondary mb-2.5">
                                            {t('machines.connection')}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.entries(selected.connectionParams)
                                                .filter(([, v]) => v !== '' && v != null)
                                                .map(([k, v]) => (
                                                    <div
                                                        key={k}
                                                        className="flex flex-col gap-1 px-2.5 py-2 rounded-lg bg-white/82 dark:bg-[#2e3338]"
                                                    >
                                                        <span className="text-[11px] text-muted uppercase tracking-wider">
                                                            {k}
                                                        </span>
                                                        <span className="text-[13px] font-semibold text-primary">
                                                            {String(v)}
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
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
                                            onClick={handleDisconnect}
                                            className="py-3 px-5 rounded-lg border-none bg-surface dark:bg-surface-elevated text-secondary text-sm font-medium cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            <WifiOff size={15} strokeWidth={2} />
                                            {t('machines.disconnect')}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleConnect(selected)}
                                            disabled={connecting}
                                            className={`flex-1 py-3 rounded-lg border-none bg-primary dark:bg-[#0d0d0d] text-white text-sm font-medium flex items-center justify-center gap-2 ${connecting ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}
                                        >
                                            {connecting ? (
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
