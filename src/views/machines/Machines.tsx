import { Plus, Search, Cpu, Activity, AlertCircle, Wifi, WifiOff, Trash2, Flame } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddMachineModal } from '../../widgets/add-machine-modal/ui/AddMachineModal';
import { useMachines, VIRTUAL_ID } from '@entities/machine';
import { sidecar } from '@shared/lib/sidecar';
import { PageLayout } from '@shared/ui/PageLayout';
import type { Machine, RoasterDef, SidecarStatus, TemperatureReading } from '@entities/machine';
import type { View } from '@shared/types/view';

const POLL_INTERVAL_MS = 3000;

export const Machines = ({
    isActive = false,
    onNavigate,
}: {
    isActive?: boolean;
    onNavigate?: (view: View) => void;
}) => {
    const { t } = useTranslation();
    const { machines, addMachine, removeMachine } = useMachines();
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);
    const [temps, setTemps] = useState<TemperatureReading | null>(null);
    const [connecting, setConnecting] = useState(false);
    
    // 마운트 시 & 모달 닫힐 때 status fetch — "Add & Connect" 흐름에서 연결 상태 즉시 반영
    useEffect(() => {
        if (!isActive) return;
        if (!isAddModalOpen) {
            sidecar
                .getStatus()
                .then(setSidecarStatus)
                .catch(() => null);
        }
    }, [isActive, isAddModalOpen]);

    useEffect(() => {
        if (!isActive || !sidecarStatus?.connected) {
            setTemps(null);
            return;
        }

        const poll = async () => {
            const [t, s] = await Promise.all([
                sidecar.getTemperatures().catch(() => null),
                sidecar.getStatus().catch(() => null),
            ]);
            if (t) setTemps(t);
            if (s) setSidecarStatus((prev) => (JSON.stringify(prev) === JSON.stringify(s) ? prev : s));
        };
        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [isActive, sidecarStatus?.connected]);

    // 연결 상태가 바뀔 때만 자동 select — 사용자가 수동으로 다른 카드를 클릭할 수 있음
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
    const isThisMachineConnected = (m: Machine) => sidecarStatus?.connected && sidecarStatus.roaster === m.roasterKey;

    const handleAdd = (roasterKey: string, def: RoasterDef, params: Record<string, unknown>) => {
        addMachine({
            name: def.display_name,
            roasterKey,
            displayName: def.display_name,
            brand: def.brand,
            models: def.models,
            protocol: def.protocol,
            connectionParams: params,
            capabilities: def.capabilities,
            pid: def.pid,
        });
    };

    const handleConnect = async (machine: Machine) => {
        setConnecting(true);
        setSidecarStatus((prev) => (prev ? { ...prev, error: null } : prev));
        try {
            const status = await sidecar.connect(
                machine.roasterKey,
                machine.connectionParams as Record<string, unknown>,
            );
            setSidecarStatus(status);
        } catch (e) {
            console.error(e);
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        const status = await sidecar.disconnect().catch(() => null);
        if (status) setSidecarStatus(status);
        setTemps(null);
    };

    const connectedMachine = machines.find(isThisMachineConnected);
    const isSelectedConnected = selected ? isThisMachineConnected(selected) : false;

    return (
        <PageLayout>
            <AddMachineModal open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={handleAdd} />

            {/* Header */}
            <div className="flex items-end justify-between mb-7">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        {/* {t('machines.title')} */}
                        Machines
                    </h1>
                    <p className="text-sm text-muted tracking-[0.14px]">
                        {t('machines.registered', { count: machines.length })}
                        {sidecarStatus?.connected && connectedMachine
                            ? ` · ${t('machines.connectedSuffix', { name: connectedMachine.name })}`
                            : ` · ${t('machines.noActiveConnection')}`}
                    </p>
                </div>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer tracking-[0.14px]"
                >
                    <Plus size={15} strokeWidth={2.5} />
                    {t('machines.addMachine')}
                </button>
            </div>

            {machines.length === 0 ? (
                <div className="bg-main-bg rounded-lg py-16 px-8 border border-[#E5E5E5] text-center">
                    <Cpu size={32} strokeWidth={1.2} color="var(--color-muted)" className="mb-4 mx-auto" />
                    <p className="text-[15px] text-muted mb-5">{t('machines.empty')}</p>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="px-5 py-2.5 rounded-[10px] border-none bg-primary text-white text-[13px] font-medium cursor-pointer"
                    >
                        {t('machines.addFirst')}
                    </button>
                </div>
            ) : (
                <div className="grid gap-5" style={{ gridTemplateColumns: '350px 1fr' }}>
                    {/* List */}
                    <div>
                        <div className="flex items-center gap-2 bg-main-bg rounded-lg px-3 py-2.25 mb-2.5 border border-[#E5E5E5]">
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
                                const isSelected = selectedId === machine.id;
                                return (
                                    <div
                                        key={machine.id}
                                        onClick={() => setSelectedId(machine.id)}
                                        className={`bg-main-bg rounded-lg px-4 py-3.5 cursor-pointer transition-all duration-150 border ${isSelected ? 'border-black/8' : 'border-[#E5E5E5]'}`}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div>
                                                <div className="text-[13px] font-medium text-primary mb-0.5">
                                                    {machine.name}
                                                </div>
                                                <div className="text-[12px] text-muted)">{machine.displayName}</div>
                                            </div>
                                            <span
                                                className={`text-[10px] font-semibold px-1.75 py-0.5 rounded-full uppercase tracking-[0.4px] shrink-0 ${isConnected ? 'text-[#16a34a] bg-[rgba(220,252,231,0.8)]' : 'text-[#64748b] bg-[rgba(241,245,249,0.8)]'}`}
                                            >
                                                {isConnected ? t('common.live') : t('common.offline')}
                                            </span>
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

                    {/* Detail */}
                    {selected ? (
                        <div className="bg-main-bg rounded-lg px-8 py-7 border border-[#E5E5E5] h-fit">
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
                                            <span
                                                key={tag}
                                                className="text-[11px] font-semibold text-secondary bg-surface px-2.25 py-0.75 rounded-full"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {selected.id !== VIRTUAL_ID && (
                                        <button
                                            onClick={() => removeMachine(selected.id)}
                                            className="w-9 h-9 rounded-[10px] border-none bg-surface text-muted flex items-center justify-center cursor-pointer"
                                            title={t('machines.removeMachine')}
                                        >
                                            <Trash2 size={15} strokeWidth={2} />
                                        </button>
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
                                    <div key={s.label} className="bg-surface px-4 py-3.5 rounded-lg">
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
                                <div className="bg-surface-warm-solid rounded-lg px-4.5 py-4 mb-6 ]">
                                    <div className="text-[12px] font-semibold text-secondary mb-2.5">
                                        {t('machines.connection')}
                                    </div>
                                    <div className="grid gap-1.5">
                                        {Object.entries(selected.connectionParams)
                                            .filter(([, v]) => v !== '' && v != null)
                                            .map(([k, v]) => (
                                                <div
                                                    key={k}
                                                    className="flex justify-between gap-3 px-2.5 py-1.75 rounded-lg bg-white/82"
                                                >
                                                    <span className="text-[11px] text-muted uppercase tracking-wider">
                                                        {k}
                                                    </span>
                                                    <span className="text-[12px] font-semibold text-primary">
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
                                        onClick={handleDisconnect}
                                        className="py-3 px-5 rounded-lg border-none bg-surface text-secondary text-sm font-medium cursor-pointer flex items-center justify-center gap-2"
                                    >
                                        <WifiOff size={15} strokeWidth={2} />
                                        {t('machines.disconnect')}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleConnect(selected)}
                                        disabled={connecting}
                                        className={`flex-1 py-3 rounded-lg border-none bg-primary text-white text-sm font-medium flex items-center justify-center gap-2 ${connecting ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}
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
                                        onClick={() => onNavigate('roast')}
                                        className="flex-1 py-3 rounded-lg border-none bg-primary text-white text-sm font-semibold cursor-pointer flex items-center justify-center gap-2"
                                    >
                                        <Flame size={15} strokeWidth={2} />
                                        {t('machines.startRoasting')}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-main-bg rounded-lg py-15 px-8 border border-[#E5E5E5] flex items-center justify-center text-muted text-sm">
                            {t('machines.selectMachine')}
                        </div>
                    )}
                </div>
            )}
        </PageLayout>
    );
};
