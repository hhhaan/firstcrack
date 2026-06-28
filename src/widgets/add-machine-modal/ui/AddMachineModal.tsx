import type { Machine, RoasterDef, SerialPort } from '@entities/machine';
import {
    buildTypedConnectionParams,
    groupRoastersByBrand,
    initRoasterFormParams,
    isRoasterFieldVisible,
    ROASTER_REGISTRY,
    validateRoasterFormFields,
} from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { sidecar } from '@shared/lib/sidecar';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ChevronDown, Cpu, Info, Loader, Radio, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CommitAction = 'add' | 'addAndConnect' | 'save' | 'saveAndConnect';

interface AddMachineModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (roasterKey: string, def: RoasterDef, params: Record<string, unknown>) => void;
    editing?: Machine | null;
    onEdit?: (id: string, params: Record<string, unknown>, keepConnection?: boolean) => Promise<void>;
}

const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';
const selectCls = `${inputCls} appearance-none pr-9 cursor-pointer`;
const labelCls = 'block text-[11px] font-semibold text-muted mb-1.5 tracking-[0.05em] uppercase';
const badgeCls =
    'text-[11px] font-semibold text-secondary bg-white/80 dark:bg-surface-elevated px-2.5 py-0.5 rounded-full shadow-(--shadow-inset)';
const secondaryBtnCls =
    'px-4 py-2.5 rounded-xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[13px] font-medium cursor-pointer shadow-(--shadow-inset) transition-colors';
const primaryConnectBtnCls =
    'flex items-center gap-1.5 px-5 py-2.5 rounded-xl border-none bg-green-600 dark:bg-green-700 text-white text-[13px] font-semibold shadow-[0_2px_8px_rgba(22,163,74,0.35)] transition-opacity';

const ROASTERS_BY_BRAND = groupRoastersByBrand(ROASTER_REGISTRY);

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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted dark:!text-[#8a8580] pointer-events-none"
            />
        </div>
    );
};

export const AddMachineModal = ({ open, onClose, onAdd, editing, onEdit }: AddMachineModalProps) => {
    const isEdit = !!editing;
    const editingId = editing?.id;
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

    const selectedDef = selectedKey ? ROASTER_REGISTRY[selectedKey] : null;

    const handleClose = useCallback(async () => {
        if (testConnectedRef.current) {
            await sidecar.disconnect().catch(() => null);
            testConnectedRef.current = false;
        }
        onClose();
    }, [onClose]);

    useFormEscape(open, () => {
        void handleClose();
    });

    useEffect(() => {
        if (!open) return;
        setError('');
        setTestState('idle');
        setTestMessage('');
        testConnectedRef.current = false;
        sidecar
            .getSerialPorts()
            .catch(() => [])
            .then((ports) => setSerialPorts(ports as SerialPort[]));
    }, [open]);

    useEffect(() => {
        if (!open) return;
        if (editingId && editing) {
            setSelectedKey(editing.roasterKey);
            const def = ROASTER_REGISTRY[editing.roasterKey];
            if (def) setParams(initRoasterFormParams(def, editing.connectionParams));
            return;
        }
        setSelectedKey('');
        setParams({});
    }, [open, editingId, editing]);

    useEffect(() => {
        if (!open || editingId || !selectedKey) return;
        const def = ROASTER_REGISTRY[selectedKey];
        if (def) setParams(initRoasterFormParams(def));
    }, [open, editingId, selectedKey]);

    const commit = async (action: CommitAction) => {
        if (!selectedDef || !selectedKey) return;
        const missing = validateRoasterFormFields(selectedDef, params);
        if (missing) {
            setError(t('addMachine.fieldRequired', { field: missing }));
            return;
        }

        const keepTest = action === 'addAndConnect' || action === 'saveAndConnect';
        const typed = buildTypedConnectionParams(selectedDef, params);
        const isSave = action === 'save' || action === 'saveAndConnect';

        if (isSave && (!editing || !onEdit)) return;

        setSaving(true);
        setError('');
        try {
            if (!keepTest && testConnectedRef.current) {
                await sidecar.disconnect().catch(() => null);
                testConnectedRef.current = false;
            }
            if (isSave) {
                await onEdit!(editing!.id, typed, keepTest);
            } else {
                onAdd(selectedKey, selectedDef, typed);
                if (action === 'addAndConnect') testConnectedRef.current = false;
            }
            if (!keepTest) onClose();
        } catch {
            setError(t(isEdit ? 'addMachine.failedToSave' : 'addMachine.failedToAdd'));
        } finally {
            setSaving(false);
        }
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

        const typedParams = buildTypedConnectionParams(selectedDef, params);

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

    const successActions = useMemo(
        () =>
            isEdit
                ? {
                      secondary: { action: 'save' as const, label: t('addMachine.saveOnly') },
                      primary: {
                          action: 'saveAndConnect' as const,
                          label: t('addMachine.saveAndConnect'),
                          loading: t('addMachine.saving'),
                      },
                  }
                : {
                      secondary: { action: 'add' as const, label: t('addMachine.addOnly') },
                      primary: {
                          action: 'addAndConnect' as const,
                          label: t('addMachine.addAndConnect'),
                          loading: t('addMachine.adding'),
                      },
                  },
        [isEdit, t],
    );

    if (!open) return null;

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
                            <ShieldCheck size={13} strokeWidth={1.9} className="dark:!text-[#a3a3a3]" />
                            {isEdit ? t('addMachine.connectionSettings') : t('addMachine.onboarding')}
                        </div>
                        <h2
                            id="add-machine-modal-title"
                            className="font-(--font-display) text-[26px] font-normal tracking-[-0.04em] text-primary m-0"
                        >
                            {isEdit ? t('addMachine.editTitle') : t('addMachine.title')}
                        </h2>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void handleClose()}
                    aria-label={t('common.close')}
                    className="w-[34px] h-[34px] rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted dark:!text-[#8a8580] flex items-center justify-center cursor-pointer shrink-0 shadow-(--shadow-inset) transition-colors hover:text-primary dark:hover:!text-[#e5e5e5]"
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
                            className={cn(selectCls, isEdit && 'opacity-70 cursor-default')}
                            value={selectedKey}
                            onChange={(e) => setSelectedKey(e.target.value)}
                            disabled={isEdit}
                        >
                            <option value="">{t('addMachine.selectRoaster')}</option>
                            {Object.entries(ROASTERS_BY_BRAND)
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
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted dark:!text-[#8a8580] pointer-events-none"
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
                        <Info size={14} className="text-blue-500 dark:!text-blue-400 shrink-0 mt-px" />
                        <span className="text-[12px] text-secondary leading-relaxed">
                            {t('addMachine.phidgetDriverNotice')}{' '}
                            <button
                                type="button"
                                onClick={() => openUrl('https://example.com/phidget-driver')}
                                className="text-blue-500 dark:!text-blue-400 underline cursor-pointer bg-transparent border-none p-0 text-[12px] font-body"
                            >
                                {t('addMachine.phidgetDriverLink')}
                            </button>
                        </span>
                    </div>
                )}

                {selectedDef && selectedDef.form_fields.length > 0 && (
                    <div className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated grid grid-cols-2 gap-4">
                        <div className="col-span-2 flex items-center gap-2 mb-1">
                            <Radio size={14} className="text-secondary dark:!text-[#a3a3a3]" />
                            <span className="text-[13px] font-semibold text-secondary">
                                {t('addMachine.connectionSettings')}
                            </span>
                        </div>
                        {selectedDef.form_fields
                            .filter((f) => isRoasterFieldVisible(f.key, params.mode))
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
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted dark:!text-[#8a8580] pointer-events-none"
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
                        {testState === 'testing' && <Loader size={14} className="animate-spin dark:!text-[#a3a3a3]" />}
                        {testState === 'success' && <Wifi size={14} className="dark:!text-green-400" />}
                        {testState === 'failed' && <WifiOff size={14} className="dark:!text-red-400" />}
                        <span>{testState === 'testing' ? t('addMachine.testingConnection') : testMessage}</span>
                        {testState === 'success' && (
                            <span className="text-[11px] text-green-600 dark:!text-green-400 opacity-70 ml-1">
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
                        <button type="button" onClick={() => void handleClose()} className={secondaryBtnCls}>
                            {t('common.cancel')}
                        </button>

                        {testState === 'success' ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => void commit(successActions.secondary.action)}
                                    disabled={saving}
                                    className={cn(secondaryBtnCls, saving && 'opacity-70 cursor-default')}
                                >
                                    {successActions.secondary.label}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void commit(successActions.primary.action)}
                                    disabled={saving}
                                    className={cn(
                                        primaryConnectBtnCls,
                                        saving ? 'opacity-70 cursor-default' : 'cursor-pointer',
                                    )}
                                >
                                    <Wifi size={14} strokeWidth={2.5} />
                                    {saving ? successActions.primary.loading : successActions.primary.label}
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => void commit(isEdit ? 'save' : 'add')}
                                disabled={!selectedKey || saving}
                                className={cn(
                                    'px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-opacity',
                                    !selectedKey
                                        ? 'border-none bg-surface dark:bg-surface-elevated text-muted cursor-default shadow-(--shadow-inset)'
                                        : 'border border-transparent dark:border-white bg-primary dark:bg-black text-white cursor-pointer shadow-(--shadow-card)',
                                    saving && 'opacity-70',
                                )}
                            >
                                {saving
                                    ? isEdit
                                        ? t('addMachine.saving')
                                        : t('addMachine.adding')
                                    : isEdit
                                      ? t('addMachine.save')
                                      : t('machines.addMachine')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </ModalShell>
    );
};
