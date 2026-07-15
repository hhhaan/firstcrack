import type { Machine, RoasterDef, RoasterFormField, SerialPort } from '@entities/machine';
import {
    addressFormFieldsForProtocol,
    buildProtocolRoasterDef,
    buildTypedConnectionParams,
    groupRoastersByBrand,
    initRoasterFormParams,
    isCustomConnectKey,
    isRoasterFieldVisible,
    listProtocols,
    PROTOCOLS_WITH_ADDRESS_MAP,
    ROASTER_REGISTRY,
    resolveCustomConnectKey,
    validateRoasterFormFields,
} from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { sidecar } from '@shared/lib/sidecar';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { Badge } from '@shared/ui/Badge';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ChevronDown, Cpu, Info, Loader, MapPin, Radio, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CommitAction = 'add' | 'addAndConnect' | 'save' | 'saveAndConnect';
type MachineModalTab = 'supported' | 'custom';

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

const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';
const selectCls = `${inputCls} appearance-none pr-9 cursor-pointer`;
const labelCls = 'block text-[11px] font-semibold text-muted mb-1.5 tracking-[0.05em] uppercase';
const secondaryBtnCls =
    'px-4 py-2.5 rounded-xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[13px] font-medium cursor-pointer shadow-(--shadow-inset) transition-colors';
const primaryConnectBtnCls =
    'flex items-center gap-1.5 px-5 py-2.5 rounded-xl border-none bg-green-600 dark:bg-green-700 text-white text-[13px] font-semibold shadow-[0_2px_8px_rgba(22,163,74,0.35)] transition-opacity';
const tabCls = (active: boolean) =>
    `flex-1 py-3 rounded-xl border-none text-sm cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white dark:bg-surface-elevated font-semibold text-primary dark:text-[#e5e5e5] shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted dark:text-[#e5e5e5] hover:text-secondary dark:hover:text-white/70'
    }`;

const ROASTERS_BY_BRAND = groupRoastersByBrand(ROASTER_REGISTRY);
const PROTOCOLS = listProtocols(ROASTER_REGISTRY);

const ComportField = ({
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
    const listId = 'serial-port-options';
    const detectedDevices = ports.map((p) => p.device);
    const showRegistryDefault = registryDefault && !detectedDevices.includes(registryDefault);

    return (
        <div>
            <input
                className={inputCls}
                type="text"
                list={listId}
                placeholder={t('addMachine.selectPort')}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoComplete="off"
            />
            <datalist id={listId}>
                {showRegistryDefault && <option value={registryDefault} />}
                {ports.map((p) => (
                    <option key={p.device} value={p.device}>
                        {p.description !== p.device ? p.description : undefined}
                    </option>
                ))}
            </datalist>
        </div>
    );
};

const FormField = ({
    field,
    value,
    onChange,
    serialPorts,
    registryDefault,
}: {
    field: RoasterFormField;
    value: string;
    onChange: (v: string) => void;
    serialPorts: SerialPort[];
    registryDefault: string;
}) => (
    <div className={field.key === 'mode' ? 'col-span-2' : ''}>
        <label className={labelCls}>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
        </label>
        {field.key === 'comport' ? (
            <ComportField value={value} onChange={onChange} ports={serialPorts} registryDefault={registryDefault} />
        ) : field.options ? (
            <div className="relative">
                <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
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
        ) : (
            <input
                className={inputCls}
                type={field.type === 'number' ? 'number' : 'text'}
                placeholder={field.placeholder ?? ''}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        )}
    </div>
);

export const AddMachineModal = ({ open, onClose, onAdd, editing, onEdit }: AddMachineModalProps) => {
    const isEdit = !!editing;
    const editingId = editing?.id;
    const { t } = useTranslation();
    const [tab, setTab] = useState<MachineModalTab>('supported');
    const [selectedKey, setSelectedKey] = useState('');
    const [params, setParams] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Custom machine fields
    const [customName, setCustomName] = useState('');
    const [customBrand, setCustomBrand] = useState('');
    const [customProtocol, setCustomProtocol] = useState('');

    type TestState = 'idle' | 'testing' | 'success' | 'failed';
    const [testState, setTestState] = useState<TestState>('idle');
    const [testMessage, setTestMessage] = useState('');
    const testConnectedRef = useRef(false);

    const [serialPorts, setSerialPorts] = useState<SerialPort[]>([]);

    const editingIsCustom = isEdit && !!editing && isCustomConnectKey(editing.roasterKey);
    const isCustom = (!isEdit && tab === 'custom') || editingIsCustom;

    const switchTab = (next: MachineModalTab) => {
        if (next === tab) return;
        setTab(next);
        setError('');
        setTestState('idle');
        setTestMessage('');
        setParams({});
        if (next === 'supported') {
            setSelectedKey('');
            setCustomName('');
            setCustomBrand('');
            setCustomProtocol('');
        } else {
            setSelectedKey('');
        }
    };

    const selectedDef: RoasterDef | null = useMemo(() => {
        if (isCustom) {
            if (editingIsCustom && editing) {
                return buildProtocolRoasterDef(editing.protocol);
            }
            if (!customProtocol) return null;
            return buildProtocolRoasterDef(customProtocol);
        }
        return selectedKey ? (ROASTER_REGISTRY[selectedKey] ?? null) : null;
    }, [isCustom, editingIsCustom, editing, customProtocol, selectedKey]);

    const protocolForAddress = selectedDef?.protocol ?? '';
    const showAddressMap = isCustom && PROTOCOLS_WITH_ADDRESS_MAP.has(protocolForAddress);
    const addressFields = showAddressMap ? addressFormFieldsForProtocol(protocolForAddress) : [];

    /** Key actually sent to sidecar connect */
    const connectKey = isCustom
        ? editingIsCustom && editing
            ? editing.roasterKey
            : (resolveCustomConnectKey(customProtocol) ?? '')
        : selectedKey;

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
            setTab('supported');
            setSelectedKey(editing.roasterKey);
            setCustomName(editing.name);
            setCustomBrand(editing.brand === 'Custom' ? '' : editing.brand);
            setCustomProtocol(editing.protocol);
            const includeAddressMap = isCustomConnectKey(editing.roasterKey);
            const def = includeAddressMap
                ? buildProtocolRoasterDef(editing.protocol)
                : ROASTER_REGISTRY[editing.roasterKey];
            if (def) setParams(initRoasterFormParams(def, editing.connectionParams, { includeAddressMap }));
            return;
        }
        setTab('supported');
        setSelectedKey('');
        setParams({});
        setCustomName('');
        setCustomBrand('');
        setCustomProtocol('');
    }, [open, editingId, editing]);

    // Known model: init params when key changes
    useEffect(() => {
        if (!open || editingId || !selectedKey || isCustom) return;
        const def = ROASTER_REGISTRY[selectedKey];
        if (def) setParams(initRoasterFormParams(def));
    }, [open, editingId, selectedKey, isCustom]);

    // Custom add: init connection + address fields when protocol changes
    useEffect(() => {
        if (!open || editingId || !isCustom || !customProtocol) return;
        const def = buildProtocolRoasterDef(customProtocol);
        setParams(initRoasterFormParams(def, undefined, { includeAddressMap: true }));
    }, [open, editingId, isCustom, customProtocol]);

    const canCommit = isCustom
        ? Boolean((isEdit || customName.trim()) && (editingIsCustom || customProtocol) && connectKey && selectedDef)
        : Boolean(selectedKey && selectedDef);

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

        const missing = validateRoasterFormFields(selectedDef, params, {
            includeAddressMap: showAddressMap,
        });
        if (missing) {
            setError(t('addMachine.fieldRequired', { field: missing }));
            return;
        }

        const keepTest = action === 'addAndConnect' || action === 'saveAndConnect';
        const typed = buildTypedConnectionParams(selectedDef, params, {
            includeAddressMap: showAddressMap,
        });
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
                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                await onEdit!(editing!.id, typed, keepTest);
            } else {
                onAdd(
                    connectKey,
                    selectedDef,
                    typed,
                    isCustom ? { name: customName.trim(), brand: customBrand.trim() || 'Custom' } : undefined,
                );
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
        if (!connectKey || !selectedDef) return;

        if (isCustom && !connectKey) {
            setError(t('addMachine.fieldRequired', { field: t('addMachine.protocol') }));
            return;
        }

        const missing = validateRoasterFormFields(selectedDef, params, {
            includeAddressMap: showAddressMap,
        });
        if (missing) {
            setError(t('addMachine.fieldRequired', { field: missing }));
            return;
        }

        if (testConnectedRef.current) {
            await sidecar.disconnect().catch(() => null);
            testConnectedRef.current = false;
        }

        setTestState('testing');
        setTestMessage('');
        setError('');

        const typedParams = buildTypedConnectionParams(selectedDef, params, {
            includeAddressMap: showAddressMap,
        });

        try {
            const status = await sidecar.connect(connectKey, typedParams);
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
                    <div className="w-11 h-11 rounded-[14px] bg-primary dark:bg-black flex items-center justify-center text-white shrink-0">
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
            <ModalScrollBody contentClassName="px-7 py-6 flex flex-col gap-5">
                {!isEdit && (
                    <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                        <button
                            type="button"
                            onClick={() => switchTab('supported')}
                            className={tabCls(tab === 'supported')}
                        >
                            {t('addMachine.tabSupported')}
                        </button>
                        <button type="button" onClick={() => switchTab('custom')} className={tabCls(tab === 'custom')}>
                            {t('addMachine.tabCustom')}
                        </button>
                    </div>
                )}

                {!isCustom && (
                    <div>
                        <label className={labelCls}>{t('addMachine.roasterModel')}</label>
                        <div className="relative">
                            <select
                                className={cn(selectCls, isEdit && 'opacity-70 cursor-default')}
                                value={selectedKey}
                                onChange={(e) => {
                                    setSelectedKey(e.target.value);
                                    setTestState('idle');
                                    setTestMessage('');
                                    setError('');
                                }}
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
                )}

                {isCustom && (
                    <div className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className={labelCls}>
                                {t('addMachine.customName')}
                                {!isEdit && <span className="text-red-500"> *</span>}
                            </label>
                            <input
                                className={cn(inputCls, isEdit && 'opacity-70 cursor-default')}
                                type="text"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder={t('addMachine.customNamePlaceholder')}
                                disabled={isEdit}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t('addMachine.customBrand')}</label>
                            <input
                                className={cn(inputCls, isEdit && 'opacity-70 cursor-default')}
                                type="text"
                                value={customBrand}
                                onChange={(e) => setCustomBrand(e.target.value)}
                                placeholder={t('addMachine.customBrandPlaceholder')}
                                disabled={isEdit}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>
                                {t('addMachine.protocol')}
                                <span className="text-red-500"> *</span>
                            </label>
                            <div className="relative">
                                <select
                                    className={cn(selectCls, isEdit && 'opacity-70 cursor-default')}
                                    value={customProtocol}
                                    onChange={(e) => {
                                        setCustomProtocol(e.target.value);
                                        setTestState('idle');
                                        setError('');
                                    }}
                                    disabled={isEdit}
                                >
                                    <option value="">{t('addMachine.selectProtocol')}</option>
                                    {PROTOCOLS.map((p) => (
                                        <option key={p} value={p}>
                                            {p.toUpperCase()}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown
                                    size={13}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted dark:!text-[#8a8580] pointer-events-none"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {selectedDef && !isCustom && (
                    <div className="bg-surface-warm-solid rounded-[14px] p-3.5 shadow-(--shadow-warm) flex gap-4 flex-wrap">
                        <div className="flex gap-1.5 flex-wrap">
                            <Badge tone="soft" className="px-2.5 font-semibold">
                                {selectedDef.protocol.toUpperCase()}
                            </Badge>
                            {selectedDef.capabilities.map((cap) => (
                                <Badge key={cap} tone="soft" className="px-2.5 font-semibold">
                                    {cap}
                                </Badge>
                            ))}
                            {selectedDef.pid && (
                                <Badge tone="soft" className="px-2.5 font-semibold">
                                    PID Kp={selectedDef.pid.Kp} Ki={selectedDef.pid.Ki} Kd={selectedDef.pid.Kd}
                                </Badge>
                            )}
                        </div>
                        {selectedDef.models.length > 0 && (
                            <div className="text-xs text-muted w-full">
                                {[...selectedDef.models].sort((a, b) => a.localeCompare(b)).join(' · ')}
                            </div>
                        )}
                    </div>
                )}

                {selectedDef && isCustom && (
                    <div className="bg-surface-warm-solid rounded-[14px] p-3.5 shadow-(--shadow-warm) flex gap-1.5 flex-wrap">
                        <Badge tone="soft" className="px-2.5 font-semibold">
                            {selectedDef.protocol.toUpperCase()}
                        </Badge>
                        {selectedDef.capabilities.map((cap) => (
                            <Badge key={cap} tone="soft" className="px-2.5 font-semibold">
                                {cap}
                            </Badge>
                        ))}
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
                                <FormField
                                    key={field.key}
                                    field={field}
                                    value={params[field.key] ?? ''}
                                    onChange={(v) => setParams((p) => ({ ...p, [field.key]: v }))}
                                    serialPorts={serialPorts}
                                    registryDefault={(selectedDef?.default_params[field.key] as string) ?? ''}
                                />
                            ))}
                    </div>
                )}

                {showAddressMap && addressFields.length > 0 && (
                    <div className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated grid grid-cols-2 gap-4">
                        <div className="col-span-2 flex flex-col gap-1 mb-1">
                            <div className="flex items-center gap-2">
                                <MapPin size={14} className="text-secondary dark:!text-[#a3a3a3]" />
                                <span className="text-[13px] font-semibold text-secondary">
                                    {t('addMachine.addressMap')}
                                </span>
                            </div>
                            <p className="text-[11px] text-muted leading-relaxed m-0">
                                {t('addMachine.addressMapHint')}
                            </p>
                        </div>
                        {addressFields.map((field) => (
                            <FormField
                                key={field.key}
                                field={field}
                                value={params[field.key] ?? ''}
                                onChange={(v) => setParams((p) => ({ ...p, [field.key]: v }))}
                                serialPorts={serialPorts}
                                registryDefault=""
                            />
                        ))}
                    </div>
                )}

                {error && (
                    <div className="text-[13px] text-red-600 dark:text-red-400 px-3 py-2 rounded-lg bg-red-500/8 dark:bg-red-500/10">
                        {error}
                    </div>
                )}
            </ModalScrollBody>

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
                        disabled={!canCommit || testState === 'testing'}
                        className={cn(
                            secondaryBtnCls,
                            'flex items-center gap-1.5',
                            (!canCommit || testState === 'testing') && 'text-muted cursor-default',
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
                                disabled={!canCommit || saving}
                                className={cn(
                                    'px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-opacity',
                                    !canCommit
                                        ? 'border-none bg-surface dark:bg-surface-elevated text-muted cursor-default shadow-(--shadow-inset)'
                                        : 'border border-transparent bg-primary dark:bg-black text-white cursor-pointer shadow-(--shadow-card)',
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
