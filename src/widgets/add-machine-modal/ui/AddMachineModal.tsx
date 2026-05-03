import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Cpu, Radio, ShieldCheck, X, ChevronDown, Wifi, WifiOff, Loader } from 'lucide-react';
import { ModalShell } from '../../../shared/ui/modal-shell/ModalShell';
import { sidecar } from '../../../shared/lib/sidecar';
import type { RoasterDef, RoastersResponse } from '../../../shared/types/machine';

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

export const AddMachineModal = ({ open, onClose, onAdd }: AddMachineModalProps) => {
  const [roasters, setRoasters] = useState<RoastersResponse>({});
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  type TestState = 'idle' | 'testing' | 'success' | 'failed';
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');
  const testCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 사이드카에서 로스터 목록 fetch
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    sidecar.getRoasters()
      .then(setRoasters)
      .catch(() => setRoasters({}))
      .finally(() => setLoading(false));
  }, [open]);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (!open) return;
    setSelectedKey('');
    setParams({});
    setError('');
    setTestState('idle');
    setTestMessage('');
    if (testCleanupRef.current) clearTimeout(testCleanupRef.current);
  }, [open]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // 로스터 선택 시 폼 파라미터 초기화
  useEffect(() => {
    if (!selectedKey || !roasters[selectedKey]) return;
    const def = roasters[selectedKey];
    const initial: Record<string, string> = {};
    for (const field of def.form_fields) {
      const defaultVal = def.default_params[field.key];
      initial[field.key] = defaultVal != null ? String(defaultVal) : '';
    }
    setParams(initial);
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // 브랜드별 그룹핑
  const brands: Record<string, { key: string; def: RoasterDef }[]> = {};
  for (const [key, def] of Object.entries(roasters)) {
    if (def.brand === 'Internal') continue; // Simulator 숨김
    if (!brands[def.brand]) brands[def.brand] = [];
    brands[def.brand].push({ key, def });
  }

  const selectedDef = selectedKey ? roasters[selectedKey] : null;

  // mode 값에 따라 TCP 전용 / RTU 전용 필드 토글
  const TCP_ONLY = new Set(['host', 'port']);
  const RTU_ONLY = new Set(['comport', 'baudrate']);

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

  const handleTestConnection = async () => {
    if (!selectedKey || !selectedDef) return;
    if (testCleanupRef.current) clearTimeout(testCleanupRef.current);

    setTestState('testing');
    setTestMessage('');
    setError('');

    const typedParams = buildTypedParams();

    try {
      const status = await sidecar.connect(selectedKey, typedParams);
      if (status.connected) {
        // 온도 한 번 읽어서 응답 확인
        const temps = await sidecar.getTemperatures().catch(() => null);
        const detail = temps?.bt != null ? ` — BT ${temps.bt}°C` : '';
        setTestState('success');
        setTestMessage(`Connected${detail}`);
        // 3초 후 자동 disconnect (테스트 목적이므로 정리)
        testCleanupRef.current = setTimeout(async () => {
          await sidecar.disconnect().catch(() => null);
          setTestState('idle');
          setTestMessage('');
        }, 3000);
      } else {
        setTestState('failed');
        setTestMessage(status.error ?? 'Connection failed');
      }
    } catch (e) {
      setTestState('failed');
      setTestMessage(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  const handleSubmit = async () => {
    if (!selectedKey || !selectedDef) return;

    // 현재 표시된 필드만 required 체크
    for (const field of selectedDef.form_fields) {
      if (!isFieldVisible(field.key)) continue;
      if (field.required && !params[field.key]?.trim()) {
        setError(`${field.label} is required`);
        return;
      }
    }

    setSaving(true);
    setError('');

    const typedParams = buildTypedParams();

    try {
      onAdd(selectedKey, selectedDef, typedParams);
      onClose();
    } catch {
      setError('Failed to add machine');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      labelledBy="add-machine-modal-title"
      contentStyle={{
        width: 'min(680px, 100%)',
        maxHeight: 'min(820px, calc(100vh - 56px))',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 28,
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 32px 80px rgba(22, 18, 12, 0.22)',
        border: '1px solid rgba(255,255,255,1)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(246,243,238,0.9) 0%, rgba(255,255,255,0.72) 100%)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        padding: '22px 28px 18px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14,
            background: 'var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', flexShrink: 0,
          }}>
            <Cpu size={20} strokeWidth={1.8} />
          </div>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 999,
              background: 'rgba(255,255,255,0.8)',
              color: 'var(--color-secondary)',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.1px',
              marginBottom: 10, boxShadow: 'var(--shadow-inset)',
            }}>
              <ShieldCheck size={13} strokeWidth={1.9} />
              Machine onboarding
            </div>
            <h2 id="add-machine-modal-title" style={{
              fontFamily: 'var(--font-display)', fontSize: 26,
              fontWeight: 400, letterSpacing: '-0.04em',
              color: 'var(--color-primary)', margin: 0,
            }}>
              Add a new machine
            </h2>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{
          width: 34, height: 34, borderRadius: 10, border: 'none',
          background: 'var(--color-surface)', color: 'var(--color-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, boxShadow: 'var(--shadow-inset)',
        }}>
          <X size={16} strokeWidth={2.3} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Roaster select */}
        <div>
          <label style={labelStyle}>Roaster Model</label>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--color-muted)', padding: '10px 0' }}>
              Loading roasters...
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <select
                style={{ ...inputStyle, appearance: 'none', paddingRight: 36, cursor: 'pointer' }}
                value={selectedKey}
                onChange={e => setSelectedKey(e.target.value)}
              >
                <option value="">Select a roaster...</option>
                {Object.entries(brands).sort(([a], [b]) => a.localeCompare(b)).map(([brand, items]) => (
                  <optgroup key={brand} label={brand}>
                    {items.map(({ key, def }) => (
                      <option key={key} value={key}>{def.display_name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={14} style={{
                position: 'absolute', right: 12, top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-muted)', pointerEvents: 'none',
              }} />
            </div>
          )}
        </div>

        {/* 선택된 로스터 정보 */}
        {selectedDef && (
          <div style={{
            background: 'var(--color-surface-warm-solid)',
            borderRadius: 14, padding: '14px 16px',
            boxShadow: 'var(--shadow-warm)',
            display: 'flex', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-secondary)',
                background: 'rgba(255,255,255,0.8)', padding: '3px 9px',
                borderRadius: 9999, boxShadow: 'var(--shadow-inset)',
              }}>
                {selectedDef.protocol.toUpperCase()}
              </span>
              {selectedDef.capabilities.map(cap => (
                <span key={cap} style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--color-secondary)',
                  background: 'rgba(255,255,255,0.8)', padding: '3px 9px',
                  borderRadius: 9999, boxShadow: 'var(--shadow-inset)',
                }}>
                  {cap}
                </span>
              ))}
              {selectedDef.pid && (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--color-secondary)',
                  background: 'rgba(255,255,255,0.8)', padding: '3px 9px',
                  borderRadius: 9999, boxShadow: 'var(--shadow-inset)',
                }}>
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

        {/* 동적 연결 폼 */}
        {selectedDef && selectedDef.form_fields.length > 0 && (
          <div style={{
            background: 'linear-gradient(180deg, rgba(250,249,247,0.95) 0%, rgba(255,255,255,0.88) 100%)',
            borderRadius: 16, padding: 20,
            border: '1px solid rgba(0,0,0,0.06)',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
          }}>
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Radio size={14} color="var(--color-secondary)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-secondary)' }}>
                Connection settings
              </span>
            </div>
            {selectedDef.form_fields.filter(f => isFieldVisible(f.key)).map(field => (
              <div key={field.key} style={field.type === 'select' ? { gridColumn: '1 / -1' } : {}}>
                <label style={labelStyle}>
                  {field.label}
                  {field.required && <span style={{ color: '#e55' }}> *</span>}
                </label>
                {field.type === 'select' && field.options ? (
                  <div style={{ position: 'relative' }}>
                    <select
                      style={{ ...inputStyle, appearance: 'none', paddingRight: 36, cursor: 'pointer' }}
                      value={params[field.key] ?? ''}
                      onChange={e => setParams(p => ({ ...p, [field.key]: e.target.value }))}
                    >
                      {field.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={13} style={{
                      position: 'absolute', right: 12, top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-muted)', pointerEvents: 'none',
                    }} />
                  </div>
                ) : (
                  <input
                    style={inputStyle}
                    type={field.type === 'number' ? 'number' : 'text'}
                    placeholder={field.placeholder ?? ''}
                    value={params[field.key] ?? ''}
                    onChange={e => setParams(p => ({ ...p, [field.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: '#c0392b', padding: '8px 12px', borderRadius: 8, background: 'rgba(192,57,43,0.08)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid rgba(0,0,0,0.05)',
        background: 'rgba(255,255,255,0.84)',
      }}>
        {/* 연결 테스트 결과 */}
        {testState !== 'idle' && (
          <div style={{
            padding: '10px 28px',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            color: testState === 'success' ? '#16a34a' : testState === 'failed' ? '#c0392b' : 'var(--color-secondary)',
            background: testState === 'success' ? 'rgba(220,252,231,0.5)' : testState === 'failed' ? 'rgba(192,57,43,0.06)' : 'transparent',
            borderBottom: '1px solid rgba(0,0,0,0.04)',
          }}>
            {testState === 'testing' && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {testState === 'success' && <Wifi size={14} />}
            {testState === 'failed' && <WifiOff size={14} />}
            <span>
              {testState === 'testing' ? 'Testing connection...' : testMessage}
            </span>
            {testState === 'success' && (
              <span style={{ fontSize: 11, color: '#16a34a', opacity: 0.7, marginLeft: 4 }}>
                (disconnecting in 3s)
              </span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 28px 22px' }}>
          {/* 왼쪽: Test Connection */}
          <button
            onClick={handleTestConnection}
            disabled={!selectedKey || testState === 'testing'}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '10px 16px', borderRadius: 10, border: 'none',
              background: 'var(--color-surface)',
              color: !selectedKey ? 'var(--color-muted)' : 'var(--color-secondary)',
              fontSize: 13, fontWeight: 500,
              cursor: selectedKey && testState !== 'testing' ? 'pointer' : 'default',
              boxShadow: 'var(--shadow-inset)',
              opacity: testState === 'testing' ? 0.6 : 1,
            }}
          >
            <Wifi size={14} strokeWidth={2} />
            Test Connection
          </button>

          {/* 오른쪽: Cancel + Add */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{
              padding: '10px 16px', borderRadius: 10, border: 'none',
              background: 'var(--color-surface)', color: 'var(--color-secondary)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              boxShadow: 'var(--shadow-inset)',
            }}>
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selectedKey || saving}
              style={{
                padding: '10px 20px', borderRadius: 10, border: 'none',
                background: !selectedKey ? 'var(--color-surface)' : 'var(--color-primary)',
                color: !selectedKey ? 'var(--color-muted)' : '#fff',
                fontSize: 13, fontWeight: 600,
                cursor: selectedKey ? 'pointer' : 'default',
                boxShadow: selectedKey ? 'var(--shadow-card)' : 'var(--shadow-inset)',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Adding...' : 'Add Machine'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
