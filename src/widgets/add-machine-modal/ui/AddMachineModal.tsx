import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Cpu, Radio, ShieldCheck, X, ChevronDown, Wifi, WifiOff, Loader, Info } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../../../shared/ui/modal-shell/ModalShell';
import { sidecar } from '../../../shared/lib/sidecar';
import { ROASTER_REGISTRY } from '@entities/machine/roasterRegistry';
import type { RoasterDef, SerialPort } from '@entities/machine';

interface AddMachineModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (roasterKey: string, def: RoasterDef, params: Record<string, unknown>) => void;
}

const inputStyle: CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.08)',
    background: 'rgba(255,255,255,0.84)',
    boxShadow: 'var(--shadow-inset)',
    fontSize: 13,
    color: 'var(--color-primary)',
    outline: 'none',
    fontFamily: 'var(--font-body)',
};

const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-muted)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const ComportSelect = ({
    value,
    onChange,
    ports,
    registryDefault,
    inputStyle,
}: {
    value: string;
    onChange: (v: string) => void;
    ports: SerialPort[];
    registryDefault: string;
    inputStyle: CSSProperties;
}) => {
    const { t } = useTranslation();
    const detectedDevices = ports.map((p) => p.device);
    const showRegistryDefault = registryDefault && !detectedDevices.includes(registryDefault);
    return (
        <div style={{ position: 'relative' }}>
            <select
                style={{ ...inputStyle, appearance: 'none', paddingRight: 36, cursor: 'pointer' }}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
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
                style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--color-muted)',
                    pointerEvents: 'none',
                }}
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
    // 테스트 성공 후 라이브 연결이 살아있는지 추적
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
        sidecar.getSerialPorts().catch(() => []).then((ports) => setSerialPorts(ports as SerialPort[]));
    }, [open]);

    // 모달 닫기: 라이브 테스트 연결이 있으면 disconnect 후 닫기
    const handleClose = async () => {
        if (testConnectedRef.current) {
            await sidecar.disconnect().catch(() => null);
            testConnectedRef.current = false;
        }
        onClose();
    };

    // ESC 닫기
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // 로스터 선택 시 폼 파라미터 초기화
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

    // 브랜드별 그룹핑
    const brands: Record<string, { key: string; def: RoasterDef }[]> = {};
    for (const [key, def] of Object.entries(ROASTER_REGISTRY)) {
        if (def.brand === 'Internal') continue; // Simulator 숨김
        if (!brands[def.brand]) brands[def.brand] = [];
        brands[def.brand].push({ key, def });
    }

    const selectedDef = selectedKey ? ROASTER_REGISTRY[selectedKey] : null;

    // mode 값에 따라 TCP 전용 / RTU 전용 필드 토글
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

        // 이전 테스트 연결 정리
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
                testConnectedRef.current = true; // 연결 유지 — "Add & Connect" 흐름에서 사용
            } else {
                setTestState('failed');
                setTestMessage(status.error ?? t('addMachine.connectionFailed'));
            }
        } catch (e) {
            setTestState('failed');
            setTestMessage(e instanceof Error ? e.message : t('addMachine.connectionFailed'));
        }
    };

    // 테스트 연결 유지한 채로 머신 추가 (권장 경로)
    const handleAddAndConnect = () => {
        if (!validateFields() || !selectedDef) return;
        setSaving(true);
        try {
            onAdd(selectedKey, selectedDef, buildTypedParams());
            testConnectedRef.current = false; // 연결 소유권을 Machines 뷰로 이전
            onClose(); // disconnect 없이 닫기
        } catch {
            setError(t('addMachine.failedToAdd'));
        } finally {
            setSaving(false);
        }
    };

    // 테스트 연결 끊고 설정만 저장
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

    // 테스트 전 단순 저장 (기존 동작)
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
            contentClassName="max-w-[680px] w-full max-h-[min(820px,calc(100vh-56px))] flex flex-col rounded-[28px] bg-[rgba(255,255,255,0.96)] backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.22)] border border-white overflow-hidden"
        >
            {/* Header */}
            <div
                style={{
                    flexShrink: 0,
                    background: 'linear-gradient(180deg, rgba(246,243,238,0.9) 0%, rgba(255,255,255,0.72) 100%)',
                    borderBottom: '1px solid rgba(0,0,0,0.05)',
                    padding: '22px 28px 18px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div
                        style={{
                            width: 44,
                            height: 44,
                            borderRadius: 14,
                            background: 'var(--color-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            flexShrink: 0,
                        }}
                    >
                        <Cpu size={20} strokeWidth={1.8} />
                    </div>
                    <div>
                        <div
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '5px 10px',
                                borderRadius: 999,
                                background: 'rgba(255,255,255,0.8)',
                                color: 'var(--color-secondary)',
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.1px',
                                marginBottom: 10,
                                boxShadow: 'var(--shadow-inset)',
                            }}
                        >
                            <ShieldCheck size={13} strokeWidth={1.9} />
                            {t('addMachine.onboarding')}
                        </div>
                        <h2
                            id="add-machine-modal-title"
                            style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 26,
                                fontWeight: 400,
                                letterSpacing: '-0.04em',
                                color: 'var(--color-primary)',
                                margin: 0,
                            }}
                        >
                            {t('addMachine.title')}
                        </h2>
                    </div>
                </div>
                <button
                    onClick={handleClose}
                    aria-label={t('common.close')}
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        border: 'none',
                        background: 'var(--color-surface)',
                        color: 'var(--color-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                        boxShadow: 'var(--shadow-inset)',
                    }}
                >
                    <X size={16} strokeWidth={2.3} />
                </button>
            </div>

            {/* Body */}
            <div
                style={{
                    padding: '24px 28px',
                    overflowY: 'auto',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 20,
                }}
            >
                {/* Roaster select */}
                <div>
                    <label style={labelStyle}>{t('addMachine.roasterModel')}</label>
                    <div style={{ position: 'relative' }}>
                        <select
                            style={{ ...inputStyle, appearance: 'none', paddingRight: 36, cursor: 'pointer' }}
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
                            style={{
                                position: 'absolute',
                                right: 12,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-muted)',
                                pointerEvents: 'none',
                            }}
                        />
                    </div>
                </div>

                {/* 선택된 로스터 정보 */}
                {selectedDef && (
                    <div
                        style={{
                            background: 'var(--color-surface-warm-solid)',
                            borderRadius: 14,
                            padding: '14px 16px',
                            boxShadow: 'var(--shadow-warm)',
                            display: 'flex',
                            gap: 16,
                            flexWrap: 'wrap',
                        }}
                    >
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <span
                                style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: 'var(--color-secondary)',
                                    background: 'rgba(255,255,255,0.8)',
                                    padding: '3px 9px',
                                    borderRadius: 9999,
                                    boxShadow: 'var(--shadow-inset)',
                                }}
                            >
                                {selectedDef.protocol.toUpperCase()}
                            </span>
                            {selectedDef.capabilities.map((cap) => (
                                <span
                                    key={cap}
                                    style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: 'var(--color-secondary)',
                                        background: 'rgba(255,255,255,0.8)',
                                        padding: '3px 9px',
                                        borderRadius: 9999,
                                        boxShadow: 'var(--shadow-inset)',
                                    }}
                                >
                                    {cap}
                                </span>
                            ))}
                            {selectedDef.pid && (
                                <span
                                    style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: 'var(--color-secondary)',
                                        background: 'rgba(255,255,255,0.8)',
                                        padding: '3px 9px',
                                        borderRadius: 9999,
                                        boxShadow: 'var(--shadow-inset)',
                                    }}
                                >
                                    PID Kp={selectedDef.pid.Kp} Ki={selectedDef.pid.Ki} Kd={selectedDef.pid.Kd}
                                </span>
                            )}
                        </div>
                        {selectedDef.models.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--color-muted)', width: '100%' }}>
                                {selectedDef.models.join(' · ')}
                            </div>
                        )}
                    </div>
                )}

                {selectedDef?.protocol === 'phidget' && (
                    <div className="flex items-start gap-2.5 bg-[rgba(59,130,246,0.07)] border border-[rgba(59,130,246,0.15)] rounded-xl px-3.5 py-[11px]">
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

                {/* 동적 연결 폼 */}
                {selectedDef && selectedDef.form_fields.length > 0 && (
                    <div
                        style={{
                            background:
                                'linear-gradient(180deg, rgba(250,249,247,0.95) 0%, rgba(255,255,255,0.88) 100%)',
                            borderRadius: 16,
                            padding: 20,
                            border: '1px solid rgba(0,0,0,0.06)',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 16,
                        }}
                    >
                        <div
                            style={{
                                gridColumn: '1 / -1',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                marginBottom: 4,
                            }}
                        >
                            <Radio size={14} color="var(--color-secondary)" />
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-secondary)' }}>
                                {t('addMachine.connectionSettings')}
                            </span>
                        </div>
                        {selectedDef.form_fields
                            .filter((f) => isFieldVisible(f.key))
                            .map((field) => (
                                <div key={field.key} style={field.type === 'select' ? { gridColumn: '1 / -1' } : {}}>
                                    <label style={labelStyle}>
                                        {field.label}
                                        {field.required && <span style={{ color: '#e55' }}> *</span>}
                                    </label>
                                    {field.options ? (
                                        <div style={{ position: 'relative' }}>
                                            <select
                                                style={{
                                                    ...inputStyle,
                                                    appearance: 'none',
                                                    paddingRight: 36,
                                                    cursor: 'pointer',
                                                }}
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
                                                style={{
                                                    position: 'absolute',
                                                    right: 12,
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    color: 'var(--color-muted)',
                                                    pointerEvents: 'none',
                                                }}
                                            />
                                        </div>
                                    ) : field.key === 'comport' && serialPorts.length > 0 ? (
                                        <ComportSelect
                                            value={params[field.key] ?? ''}
                                            onChange={(v) => setParams((p) => ({ ...p, [field.key]: v }))}
                                            ports={serialPorts}
                                            registryDefault={(selectedDef?.default_params[field.key] as string) ?? ''}
                                            inputStyle={inputStyle}
                                        />
                                    ) : (
                                        <input
                                            style={inputStyle}
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
                    <div
                        style={{
                            fontSize: 13,
                            color: '#c0392b',
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'rgba(192,57,43,0.08)',
                        }}
                    >
                        {error}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div
                style={{
                    borderTop: '1px solid rgba(0,0,0,0.05)',
                    background: 'rgba(255,255,255,0.84)',
                }}
            >
                {/* 연결 테스트 결과 */}
                {testState !== 'idle' && (
                    <div
                        style={{
                            padding: '10px 28px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                            color:
                                testState === 'success'
                                    ? '#16a34a'
                                    : testState === 'failed'
                                      ? '#c0392b'
                                      : 'var(--color-secondary)',
                            background:
                                testState === 'success'
                                    ? 'rgba(220,252,231,0.5)'
                                    : testState === 'failed'
                                      ? 'rgba(192,57,43,0.06)'
                                      : 'transparent',
                            borderBottom: '1px solid rgba(0,0,0,0.04)',
                        }}
                    >
                        {testState === 'testing' && (
                            <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                        )}
                        {testState === 'success' && <Wifi size={14} />}
                        {testState === 'failed' && <WifiOff size={14} />}
                        <span>{testState === 'testing' ? t('addMachine.testingConnection') : testMessage}</span>
                        {testState === 'success' && (
                            <span style={{ fontSize: 11, color: '#16a34a', opacity: 0.7, marginLeft: 4 }}>(live)</span>
                        )}
                    </div>
                )}

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        padding: '14px 28px 22px',
                    }}
                >
                    {/* 왼쪽: Test Connection */}
                    <button
                        onClick={handleTestConnection}
                        disabled={!selectedKey || testState === 'testing'}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            padding: '10px 16px',
                            borderRadius: 10,
                            border: 'none',
                            background: 'var(--color-surface)',
                            color: !selectedKey ? 'var(--color-muted)' : 'var(--color-secondary)',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: selectedKey && testState !== 'testing' ? 'pointer' : 'default',
                            boxShadow: 'var(--shadow-inset)',
                            opacity: testState === 'testing' ? 0.6 : 1,
                        }}
                    >
                        <Wifi size={14} strokeWidth={2} />
                        {t('addMachine.testConnection')}
                    </button>

                    {/* 오른쪽: 상황별 버튼 */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <button
                            onClick={handleClose}
                            style={{
                                padding: '10px 16px',
                                borderRadius: 10,
                                border: 'none',
                                background: 'var(--color-surface)',
                                color: 'var(--color-secondary)',
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-inset)',
                            }}
                        >
                            {t('common.cancel')}
                        </button>

                        {testState === 'success' ? (
                            // 테스트 성공: Add & Connect (primary) + Add only (secondary)
                            <>
                                <button
                                    onClick={handleAddOnly}
                                    disabled={saving}
                                    style={{
                                        padding: '10px 16px',
                                        borderRadius: 10,
                                        border: 'none',
                                        background: 'var(--color-surface)',
                                        color: 'var(--color-secondary)',
                                        fontSize: 13,
                                        fontWeight: 500,
                                        cursor: saving ? 'default' : 'pointer',
                                        boxShadow: 'var(--shadow-inset)',
                                        opacity: saving ? 0.7 : 1,
                                    }}
                                >
                                    {t('addMachine.addOnly')}
                                </button>
                                <button
                                    onClick={handleAddAndConnect}
                                    disabled={saving}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 7,
                                        padding: '10px 20px',
                                        borderRadius: 10,
                                        border: 'none',
                                        background: '#16a34a',
                                        color: '#fff',
                                        fontSize: 13,
                                        fontWeight: 600,
                                        cursor: saving ? 'default' : 'pointer',
                                        boxShadow: '0 2px 8px rgba(22,163,74,0.35)',
                                        opacity: saving ? 0.7 : 1,
                                    }}
                                >
                                    <Wifi size={14} strokeWidth={2.5} />
                                    {saving ? t('addMachine.adding') : t('addMachine.addAndConnect')}
                                </button>
                            </>
                        ) : (
                            // 기본: Add Machine
                            <button
                                onClick={handleSubmit}
                                disabled={!selectedKey || saving}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: 10,
                                    border: 'none',
                                    background: !selectedKey ? 'var(--color-surface)' : 'var(--color-primary)',
                                    color: !selectedKey ? 'var(--color-muted)' : '#fff',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: selectedKey ? 'pointer' : 'default',
                                    boxShadow: selectedKey ? 'var(--shadow-card)' : 'var(--shadow-inset)',
                                    opacity: saving ? 0.7 : 1,
                                }}
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
