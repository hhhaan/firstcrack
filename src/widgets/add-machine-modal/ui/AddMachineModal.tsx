import { useEffect, useRef, useState } from 'react';
import { Cpu, Radio, ShieldCheck, X, ChevronDown, Wifi, WifiOff, Loader, Info } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../../../shared/ui/modal-shell/ModalShell';
import { sidecar } from '../../../shared/lib/sidecar';
import { ROASTER_REGISTRY } from '@entities/machine/roasterRegistry';
import type { RoasterDef, SerialPort } from '@entities/machine';
import { cn } from '@shared/lib/cn';

interface AddMachineModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (roasterKey: string, def: RoasterDef, params: Record<string, unknown>) => void;
}

const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';
const selectCls = `${inputCls} appearance-none pr-9 cursor-pointer`;
const labelCls = 'block text-[11px] font-semibold text-muted mb-1.5 tracking-[0.05em] uppercase';
const badgeCls =
    'text-[11px] font-semibold text-secondary bg-white/80 dark:bg-surface-elevated px-2.5 py-0.5 rounded-full shadow-(--shadow-inset)';
const secondaryBtnCls =
    'px-4 py-2.5 rounded-xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-white text-[13px] font-medium cursor-pointer shadow-(--shadow-inset) transition-colors';

const ComportSelect = ({
    value,
    onChange,
    ports,
    registryDefault,
}: {
    value: string;
    onChange: (v: string) => void;
    ports: SerialPort[];
    registryDefault: string;
}) => {
    const { t } = useTranslation();
    const detectedDevices = ports.map((p) => p.device);
    const showRegistryDefault = registryDefault && !detectedDevices.includes(registryDefault);
    return (
        <div className="relative">
            <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">{t('addMachine.selectPort')}</option>
                {showRegistryDefault && (
                    <option value={registryDefault}>
                        {registryDefault} ({t('addMachine.defaultPort')})
                    </option>
                )}
                {ports.map((p) => (
                    <option key={p.device} value={p.device}>
                        {p.device}
                        {p.description !== p.device ? ` — ${p.description}` : ''}
                    </option>
                ))}
            </select>
            <ChevronDown
                size={13}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
        </div>
    );
};

export const AddMachineModal = ({ open, onClose, onAdd }: AddMachineModalProps) => {
    const { t } = useTranslation();
    const [selectedKey, setSelectedKey] = useState('');
    const [params, setParams] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    type TestState = 'idle' | 'testing' | 'success' | 'failed';
    const [testState, setTestState] = useState<TestState>('idle');
    const [testMessage, setTestMessage] = useState('');
    const testConnectedRef = useRef(false);

    const [serialPorts, setSerialPorts] = useState<SerialPort[]>([]);

    useEffect(() => {
        if (!open) return;
        setSelectedKey('');
        setParams({});
        setError('');
        setTestState('idle');
        setTestMessage('');
        testConnectedRef.current = false;
        sidecar
            .getSerialPorts()
            .catch(() => [])
            .then((ports) => setSerialPorts(ports as SerialPort[]));
    }, [open]);

    const handleClose = async () => {
        if (testConnectedRef.current) {
            await sidecar.disconnect().catch(() => null);
            testConnectedRef.current = false;
        }
        onClose();
    };

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!selectedKey || !ROASTER_REGISTRY[selectedKey]) return;
        const def = ROASTER_REGISTRY[selectedKey];
        const initial: Record<string, string> = {};
        for (const field of def.form_fields) {
            const defaultVal = def.default_params[field.key];
            initial[field.key] = defaultVal != null ? String(defaultVal) : '';
        }
        setParams(initial);
    }, [selectedKey]);

    if (!open) return null;

    const brands: Record<string, { key: string; def: RoasterDef }[]> = {};
    for (const [key, def] of Object.entries(ROASTER_REGISTRY)) {
        if (def.brand === 'Internal') continue;
        if (!brands[def.brand]) brands[def.brand] = [];
        brands[def.brand].push({ key, def });
    }

    const selectedDef = selectedKey ? ROASTER_REGISTRY[selectedKey] : null;

    const TCP_ONLY = new Set(['host', 'port']);
    const RTU_ONLY = new Set(['comport', 'baudrate', 'bytesize', 'parity', 'stopbits']);

    const isFieldVisible = (fieldKey: string): boolean => {
        const mode = params['mode']?.toLowerCase() ?? '';
        if (!mode) return true;
        const isTCP = mode === 'tcp' || mode === 'udp';
        const isRTU = mode === 'rtu' || mode === 'serial';
        if (TCP_ONLY.has(fieldKey) && isRTU) return false;
        if (RTU_ONLY.has(fieldKey) && isTCP) return false;
        return true;
    };

    const buildTypedParams = (): Record<string, unknown> => {
        if (!selectedDef) return {};
        const result: Record<string, unknown> = {};
        for (const field of selectedDef.form_fields) {
            if (!isFieldVisible(field.key)) continue;
            const raw = params[field.key];
            if (raw === '' || raw == null) continue;
            result[field.key] = field.type === 'number' ? Number(raw) : raw;
        }
        return result;
    };

    const validateFields = (): boolean => {
        if (!selectedKey || !selectedDef) return false;
        for (const field of selectedDef.form_fields) {
            if (!isFieldVisible(field.key)) continue;
            if (field.required && !params[field.key]?.trim()) {
                setError(t('addMachine.fieldRequired', { field: field.label }));
                return false;
            }
        }
        return true;
    };

    const handleTestConnection = async () => {
        if (!selectedKey || !selectedDef) return;

        if (testConnectedRef.current) {
            await sidecar.disconnect().catch(() => null);
            testConnectedRef.current = false;
        }

        setTestState('testing');
        setTestMessage('');
        setError('');

        const typedParams = buildTypedParams();

        try {
            const status = await sidecar.connect(selectedKey, typedParams);
            if (status.connected) {
                const temps = await sidecar.getTemperatures().catch(() => null);
                setTestState('success');
                setTestMessage(
                    temps?.bt != null ? t('addMachine.connectedWithBt', { bt: temps.bt }) : t('common.connected'),
                );
                testConnectedRef.current = true;
            } else {
                setTestState('failed');
                setTestMessage(status.error ?? t('addMachine.connectionFailed'));
            }
        } catch (e) {
            setTestState('failed');
            setTestMessage(e instanceof Error ? e.message : t('addMachine.connectionFailed'));
        }
    };

    const handleAddAndConnect = () => {
        if (!validateFields() || !selectedDef) return;
        setSaving(true);
        try {
            onAdd(selectedKey, selectedDef, buildTypedParams());
            testConnectedRef.current = false;
            onClose();
        } catch {
            setError(t('addMachine.failedToAdd'));
        } finally {
            setSaving(false);
        }
    };

    const handleAddOnly = async () => {
        if (!validateFields() || !selectedDef) return;
        setSaving(true);
        setError('');
        try {
            if (testConnectedRef.current) {
                await sidecar.disconnect().catch(() => null);
                testConnectedRef.current = false;
            }
            onAdd(selectedKey, selectedDef, buildTypedParams());
            onClose();
        } catch {
            setError(t('addMachine.failedToAdd'));
        } finally {
            setSaving(false);
        }
    };

    const handleSubmit = async () => {
        if (!validateFields() || !selectedDef) return;
        setSaving(true);
        setError('');
        try {
            onAdd(selectedKey, selectedDef, buildTypedParams());
            onClose();
        } catch {
            setError(t('addMachine.failedToAdd'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell
            onClose={handleClose}
            labelledBy="add-machine-modal-title"
            contentClassName="max-w-[680px] w-full max-h-[min(820px,calc(100vh-56px))] flex flex-col rounded-[16px] bg-[rgba(255,255,255,0.97)] dark:bg-[#181d21] dark:[&_*]:!text-white backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.22)] border border-white dark:border-[#585d61] overflow-hidden"
        >
            {/* Header */}
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm border-b border-black/4 dark:border-[#585d61] px-7 pt-5.5 pb-4.5 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-[14px] bg-primary flex items-center justify-center text-white shrink-0">
                        <Cpu size={20} strokeWidth={1.8} />
                    </div>
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/80 dark:bg-surface-elevated text-secondary text-[11px] font-semibold tracking-[0.1px] mb-2.5 shadow-(--shadow-inset)">
                            <ShieldCheck size={13} strokeWidth={1.9} />
                            {t('addMachine.onboarding')}
                        </div>
                        <h2
                            id="add-machine-modal-title"
                            className="font-(--font-display) text-[26px] font-normal tracking-[-0.04em] text-primary m-0"
                        >
                            {t('addMachine.title')}
                        </h2>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleClose}
                    aria-label={t('common.close')}
                    className="w-[34px] h-[34px] rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer shrink-0 shadow-(--shadow-inset) transition-colors hover:text-primary"
                >
                    <X size={16} strokeWidth={2.3} />
                </button>
            </div>

            {/* Body */}
            <div className="px-7 py-6 overflow-y-auto flex-1 flex flex-col gap-5">
                <div>
                    <label className={labelCls}>{t('addMachine.roasterModel')}</label>
                    <div className="relative">
                        <select
                            className={selectCls}
                            value={selectedKey}
                            onChange={(e) => setSelectedKey(e.target.value)}
                        >
                            <option value="">{t('addMachine.selectRoaster')}</option>
                            {Object.entries(brands)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([brand, items]) => (
                                    <optgroup key={brand} label={brand}>
                                        {items.map(({ key, def }) => (
                                            <option key={key} value={key}>
                                                {def.display_name}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                        </select>
                        <ChevronDown
                            size={14}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                        />
                    </div>
                </div>

                {selectedDef && (
                    <div className="bg-surface-warm-solid rounded-[14px] p-3.5 shadow-(--shadow-warm) flex gap-4 flex-wrap">
                        <div className="flex gap-1.5 flex-wrap">
                            <span className={badgeCls}>{selectedDef.protocol.toUpperCase()}</span>
                            {selectedDef.capabilities.map((cap) => (
                                <span key={cap} className={badgeCls}>
                                    {cap}
                                </span>
                            ))}
                            {selectedDef.pid && (
                                <span className={badgeCls}>
                                    PID Kp={selectedDef.pid.Kp} Ki={selectedDef.pid.Ki} Kd={selectedDef.pid.Kd}
                                </span>
                            )}
                        </div>
                        {selectedDef.models.length > 0 && (
                            <div className="text-xs text-muted w-full">{selectedDef.models.join(' · ')}</div>
                        )}
                    </div>
                )}

                {selectedDef?.protocol === 'phidget' && (
                    <div className="flex items-start gap-2.5 bg-[rgba(59,130,246,0.07)] dark:bg-blue-500/10 border border-[rgba(59,130,246,0.15)] dark:border-blue-500/20 rounded-xl px-3.5 py-[11px]">
                        <Info size={14} className="text-blue-500 shrink-0 mt-px" />
                        <span className="text-[12px] text-secondary leading-relaxed">
                            {t('addMachine.phidgetDriverNotice')}{' '}
                            <button
                                type="button"
                                onClick={() => openUrl('https://example.com/phidget-driver')}
                                className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 text-[12px] font-body"
                            >
                                {t('addMachine.phidgetDriverLink')}
                            </button>
                        </span>
                    </div>
                )}

                {selectedDef && selectedDef.form_fields.length > 0 && (
                    <div className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated grid grid-cols-2 gap-4">
                        <div className="col-span-2 flex items-center gap-2 mb-1">
                            <Radio size={14} className="text-secondary" />
                            <span className="text-[13px] font-semibold text-secondary">
                                {t('addMachine.connectionSettings')}
                            </span>
                        </div>
                        {selectedDef.form_fields
                            .filter((f) => isFieldVisible(f.key))
                            .map((field) => (
                                <div key={field.key} className={field.key === 'mode' ? 'col-span-2' : ''}>
                                    <label className={labelCls}>
                                        {field.label}
                                        {field.required && <span className="text-red-500"> *</span>}
                                    </label>
                                    {field.options ? (
                                        <div className="relative">
                                            <select
                                                className={selectCls}
                                                value={params[field.key] ?? ''}
                                                onChange={(e) =>
                                                    setParams((p) => ({ ...p, [field.key]: e.target.value }))
                                                }
                                            >
                                                {field.options.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                            <ChevronDown
                                                size={13}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                                            />
                                        </div>
                                    ) : field.key === 'comport' && serialPorts.length > 0 ? (
                                        <ComportSelect
                                            value={params[field.key] ?? ''}
                                            onChange={(v) => setParams((p) => ({ ...p, [field.key]: v }))}
                                            ports={serialPorts}
                                            registryDefault={(selectedDef?.default_params[field.key] as string) ?? ''}
                                        />
                                    ) : (
                                        <input
                                            className={inputCls}
                                            type={field.type === 'number' ? 'number' : 'text'}
                                            placeholder={field.placeholder ?? ''}
                                            value={params[field.key] ?? ''}
                                            onChange={(e) => setParams((p) => ({ ...p, [field.key]: e.target.value }))}
                                        />
                                    )}
                                </div>
                            ))}
                    </div>
                )}

                {error && (
                    <div className="text-[13px] text-red-600 dark:text-red-400 px-3 py-2 rounded-lg bg-red-500/8 dark:bg-red-500/10">
                        {error}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="border-t border-black/4 dark:border-[#585d61] bg-white/60 dark:bg-[#1a1e23]">
                {testState !== 'idle' && (
                    <div
                        className={cn(
                            'px-7 py-2.5 flex items-center gap-2 text-[13px] border-b border-black/4 dark:border-[#585d61]',
                            testState === 'success' &&
                                'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10',
                            testState === 'failed' && 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
                            testState === 'testing' && 'text-secondary',
                        )}
                    >
                        {testState === 'testing' && <Loader size={14} className="animate-spin" />}
                        {testState === 'success' && <Wifi size={14} />}
                        {testState === 'failed' && <WifiOff size={14} />}
                        <span>{testState === 'testing' ? t('addMachine.testingConnection') : testMessage}</span>
                        {testState === 'success' && (
                            <span className="text-[11px] text-green-600 dark:text-green-400 opacity-70 ml-1">
                                (live)
                            </span>
                        )}
                    </div>
                )}

                <div className="flex justify-between items-center gap-2.5 px-7 pt-3.5 pb-5.5">
                    <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={!selectedKey || testState === 'testing'}
                        className={cn(
                            secondaryBtnCls,
                            'flex items-center gap-1.5',
                            (!selectedKey || testState === 'testing') && 'text-muted cursor-default',
                            testState === 'testing' && 'opacity-60',
                        )}
                    >
                        <Wifi size={14} strokeWidth={2} />
                        {t('addMachine.testConnection')}
                    </button>

                    <div className="flex gap-2.5 items-center">
                        <button type="button" onClick={handleClose} className={secondaryBtnCls}>
                            {t('common.cancel')}
                        </button>

                        {testState === 'success' ? (
                            <>
                                <button
                                    type="button"
                                    onClick={handleAddOnly}
                                    disabled={saving}
                                    className={cn(secondaryBtnCls, saving && 'opacity-70 cursor-default')}
                                >
                                    {t('addMachine.addOnly')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAddAndConnect}
                                    disabled={saving}
                                    className={cn(
                                        'flex items-center gap-1.5 px-5 py-2.5 rounded-xl border-none bg-green-600 dark:bg-green-700 text-white text-[13px] font-semibold shadow-[0_2px_8px_rgba(22,163,74,0.35)] transition-opacity',
                                        saving ? 'opacity-70 cursor-default' : 'cursor-pointer',
                                    )}
                                >
                                    <Wifi size={14} strokeWidth={2.5} />
                                    {saving ? t('addMachine.adding') : t('addMachine.addAndConnect')}
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!selectedKey || saving}
                                className={cn(
                                    'px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-opacity',
                                    !selectedKey
                                        ? 'border-none bg-surface dark:bg-surface-elevated text-muted cursor-default shadow-(--shadow-inset)'
                                        : 'border border-transparent dark:border-white bg-primary dark:bg-black text-white cursor-pointer shadow-(--shadow-card)',
                                    saving && 'opacity-70',
                                )}
                            >
                                {saving ? t('addMachine.adding') : t('machines.addMachine')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </ModalShell>
    );
};
