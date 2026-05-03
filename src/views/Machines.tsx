import { Plus, Search, Cpu, Activity, AlertCircle, CheckCircle2, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AddMachineModal } from '../widgets/add-machine-modal/ui/AddMachineModal';
import { useMachines } from '../shared/data/useMachines';
import { sidecar } from '../shared/lib/sidecar';
import type { Machine, RoasterDef, SidecarStatus, TemperatureReading } from '../shared/types/machine';

const POLL_INTERVAL_MS = 3000;

export const Machines = () => {
  const { machines, addMachine, removeMachine } = useMachines();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // 사이드카 연결 상태
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);
  const [temps, setTemps] = useState<TemperatureReading | null>(null);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 초기 상태 조회
  useEffect(() => {
    sidecar.getStatus().then(setSidecarStatus).catch(() => null);
  }, []);

  // 연결 상태 변화 시 폴링 시작/중지
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!sidecarStatus?.connected) { setTemps(null); return; }

    const poll = async () => {
      const t = await sidecar.getTemperatures().catch(() => null);
      if (t) setTemps(t);
      const s = await sidecar.getStatus().catch(() => null);
      if (s) setSidecarStatus(s);
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sidecarStatus?.connected]);

  const filtered = machines.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.brand.toLowerCase().includes(search.toLowerCase())
  );

  const selected = machines.find(m => m.id === selectedId) ?? null;
  const isThisMachineConnected = (m: Machine) =>
    sidecarStatus?.connected && sidecarStatus.roaster === m.roasterKey;

  const handleAdd = (
    roasterKey: string,
    def: RoasterDef,
    params: Record<string, unknown>,
  ) => {
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
    try {
      const status = await sidecar.connect(machine.roasterKey, machine.connectionParams as Record<string, unknown>);
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

  const connectedMachine = machines.find(m => sidecarStatus?.connected && sidecarStatus.roaster === m.roasterKey);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      <AddMachineModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAdd}
      />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 32,
            lineHeight: 1.13, color: 'var(--color-primary)',
            letterSpacing: '-0.4px', marginBottom: 4,
          }}>
            Machine Inventory
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
            {machines.length} registered
            {sidecarStatus?.connected && connectedMachine
              ? ` · ${connectedMachine.name} connected`
              : ' · no active connection'}
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', borderRadius: 9999, border: 'none',
            background: 'var(--color-primary)', color: 'white',
            fontSize: 14, fontWeight: 500, cursor: 'pointer',
            boxShadow: 'var(--shadow-card)', letterSpacing: '0.14px',
          }}
        >
          <Plus size={15} strokeWidth={2.5} />
          Add Machine
        </button>
      </div>

      {machines.length === 0 ? (
        <div style={{
          background: 'var(--color-main-bg)', borderRadius: 16, padding: '64px 32px',
          boxShadow: 'var(--shadow-ring)', textAlign: 'center',
        }}>
          <Cpu size={32} strokeWidth={1.2} color="var(--color-muted)" style={{ marginBottom: 16 }} />
          <p style={{ fontSize: 15, color: 'var(--color-muted)', marginBottom: 20 }}>
            No machines registered yet
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            style={{
              padding: '10px 20px', borderRadius: 10, border: 'none',
              background: 'var(--color-primary)', color: 'white',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Add your first machine
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>

          {/* List */}
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--color-main-bg)', borderRadius: 10,
              padding: '9px 12px', marginBottom: 10, boxShadow: 'var(--shadow-ring)',
            }}>
              <Search size={14} strokeWidth={2} color="var(--color-muted)" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search machines..."
                style={{
                  border: 'none', background: 'transparent', outline: 'none',
                  fontSize: 13, color: 'var(--color-primary)',
                  fontFamily: 'var(--font-body)', width: '100%', letterSpacing: '0.14px',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(machine => {
                const isConnected = isThisMachineConnected(machine);
                const isSelected = selectedId === machine.id;
                return (
                  <div
                    key={machine.id}
                    onClick={() => setSelectedId(machine.id)}
                    style={{
                      background: 'var(--color-main-bg)', borderRadius: 14,
                      padding: '14px 16px', cursor: 'pointer',
                      boxShadow: isSelected
                        ? 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.06) 0px 2px 8px'
                        : 'var(--shadow-ring)',
                      border: isSelected ? '1px solid rgba(0,0,0,0.08)' : '1px solid transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-primary)', marginBottom: 2 }}>
                          {machine.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {machine.displayName}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        color: isConnected ? '#16a34a' : '#64748b',
                        background: isConnected ? 'rgba(220,252,231,0.8)' : 'rgba(241,245,249,0.8)',
                        padding: '2px 7px', borderRadius: 9999,
                        textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0,
                      }}>
                        {isConnected ? 'Live' : 'Offline'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Activity size={11} /> {machine.protocol.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                        {machine.brand}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          {selected ? (
            <div style={{
              background: 'var(--color-main-bg)', borderRadius: 16,
              padding: '28px 32px', boxShadow: 'var(--shadow-ring)', height: 'fit-content',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                  <h2 style={{
                    fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 26,
                    lineHeight: 1.2, color: 'var(--color-primary)',
                    letterSpacing: '-0.3px', marginBottom: 8,
                  }}>
                    {selected.name}
                  </h2>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[selected.brand, selected.protocol.toUpperCase(), ...selected.capabilities].map(tag => (
                      <span key={tag} style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--color-secondary)',
                        background: 'var(--color-surface)', padding: '3px 9px',
                        borderRadius: 9999, boxShadow: 'var(--shadow-inset)',
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => removeMachine(selected.id)}
                    style={{
                      width: 36, height: 36, borderRadius: 10, border: 'none',
                      background: 'var(--color-surface)', color: 'var(--color-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', boxShadow: 'var(--shadow-inset)',
                    }}
                    title="Remove machine"
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>

              {/* 온도 카드 (연결 시) */}
              {isThisMachineConnected(selected) && temps ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
                  {[
                    { label: 'Bean Temp', value: temps.bt != null ? `${temps.bt}°C` : '—', sub: 'BT' },
                    { label: 'Env Temp', value: temps.et != null ? `${temps.et}°C` : '—', sub: 'ET' },
                    { label: 'RoR', value: `${temps.ror} °C/min`, sub: 'Rate of Rise' },
                  ].map(s => (
                    <div key={s.label} style={{
                      background: 'var(--color-surface)', padding: '14px 16px',
                      borderRadius: 12, boxShadow: 'var(--shadow-inset)',
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--color-primary)', letterSpacing: '-0.3px' }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{s.sub}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  background: 'var(--color-surface)', borderRadius: 12,
                  padding: '20px 16px', marginBottom: 24,
                  display: 'flex', alignItems: 'center', gap: 12,
                  boxShadow: 'var(--shadow-inset)',
                }}>
                  {isThisMachineConnected(selected)
                    ? <Wifi size={18} color="#16a34a" />
                    : <WifiOff size={18} color="var(--color-muted)" />}
                  <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    {isThisMachineConnected(selected)
                      ? 'Connected — waiting for data...'
                      : 'Not connected. Press Connect to start.'}
                  </span>
                </div>
              )}

              {/* 연결 파라미터 요약 */}
              {Object.keys(selected.connectionParams).length > 0 && (
                <div style={{
                  background: 'var(--color-surface-warm-solid)', borderRadius: 12,
                  padding: '16px 18px', marginBottom: 24,
                  boxShadow: 'var(--shadow-warm)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-secondary)', marginBottom: 10 }}>
                    Connection
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {Object.entries(selected.connectionParams).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                      <div key={k} style={{
                        display: 'flex', justifyContent: 'space-between', gap: 12,
                        padding: '7px 10px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.82)', boxShadow: 'var(--shadow-inset)',
                      }}>
                        <span style={{ fontSize: 11, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)' }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 에러 */}
              {sidecarStatus?.error && isThisMachineConnected(selected) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(192,57,43,0.07)', borderRadius: 10,
                  padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#c0392b',
                }}>
                  <AlertCircle size={14} />
                  {sidecarStatus.error}
                </div>
              )}

              {/* Connect / Disconnect */}
              <div style={{ display: 'flex', gap: 10 }}>
                {isThisMachineConnected(selected) ? (
                  <button
                    onClick={handleDisconnect}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                      background: 'var(--color-surface)', color: 'var(--color-secondary)',
                      fontSize: 14, fontWeight: 500, cursor: 'pointer',
                      boxShadow: 'var(--shadow-inset)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    <WifiOff size={15} strokeWidth={2} />
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(selected)}
                    disabled={connecting}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                      background: 'var(--color-primary)', color: 'white',
                      fontSize: 14, fontWeight: 500, cursor: connecting ? 'default' : 'pointer',
                      boxShadow: 'var(--shadow-card)', opacity: connecting ? 0.7 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    {connecting
                      ? <><Activity size={15} /> Connecting...</>
                      : <><Wifi size={15} strokeWidth={2} /> Connect</>}
                  </button>
                )}
              </div>

              {/* 연결 상태 뱃지 */}
              {isThisMachineConnected(selected) && (
                <div style={{
                  marginTop: 12, display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: '#16a34a',
                }}>
                  <CheckCircle2 size={13} />
                  Uptime {sidecarStatus?.uptime}s
                </div>
              )}
            </div>
          ) : (
            <div style={{
              background: 'var(--color-main-bg)', borderRadius: 16,
              padding: '60px 32px', boxShadow: 'var(--shadow-ring)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-muted)', fontSize: 14,
            }}>
              Select a machine
            </div>
          )}
        </div>
      )}
    </div>
  );
};
