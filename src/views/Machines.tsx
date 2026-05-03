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

  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);
  const [temps, setTemps] = useState<TemperatureReading | null>(null);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    sidecar.getStatus().then(setSidecarStatus).catch(() => null);
  }, []);

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
    <div className="px-10 py-8 max-w-[1100px] mx-auto">
      <AddMachineModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAdd}
      />

      {/* Header */}
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="font-display font-light text-[32px] leading-[1.13] text-(--color-primary) tracking-[-0.4px] mb-1">
            Machine Inventory
          </h1>
          <p className="text-sm text-(--color-muted) tracking-[0.14px]">
            {machines.length} registered
            {sidecarStatus?.connected && connectedMachine
              ? ` · ${connectedMachine.name} connected`
              : ' · no active connection'}
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-[18px] py-[10px] rounded-full border-none bg-(--color-primary) text-white text-sm font-medium cursor-pointer shadow-(--shadow-card) tracking-[0.14px]"
        >
          <Plus size={15} strokeWidth={2.5} />
          Add Machine
        </button>
      </div>

      {machines.length === 0 ? (
        <div className="bg-(--color-main-bg) rounded-2xl py-16 px-8 shadow-(--shadow-ring) text-center">
          <Cpu size={32} strokeWidth={1.2} color="var(--color-muted)" className="mb-4 mx-auto" />
          <p className="text-[15px] text-(--color-muted) mb-5">
            No machines registered yet
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-5 py-[10px] rounded-[10px] border-none bg-(--color-primary) text-white text-[13px] font-medium cursor-pointer"
          >
            Add your first machine
          </button>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: '300px 1fr' }}>

          {/* List */}
          <div>
            <div className="flex items-center gap-2 bg-(--color-main-bg) rounded-[10px] px-3 py-[9px] mb-[10px] shadow-(--shadow-ring)">
              <Search size={14} strokeWidth={2} color="var(--color-muted)" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search machines..."
                className="border-none bg-transparent outline-none text-[13px] text-(--color-primary) font-body w-full tracking-[0.14px]"
              />
            </div>

            <div className="flex flex-col gap-2">
              {filtered.map(machine => {
                const isConnected = isThisMachineConnected(machine);
                const isSelected = selectedId === machine.id;
                return (
                  <div
                    key={machine.id}
                    onClick={() => setSelectedId(machine.id)}
                    className={`bg-(--color-main-bg) rounded-[14px] px-4 py-[14px] cursor-pointer transition-all duration-150 ${isSelected ? 'border border-black/8 shadow-[rgba(0,0,0,0.4)_0px_0px_1px,rgba(0,0,0,0.06)_0px_2px_8px]' : 'border border-transparent shadow-(--shadow-ring)'}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-[13px] font-medium text-(--color-primary) mb-0.5">
                          {machine.name}
                        </div>
                        <div className="text-[12px] text-(--color-muted)">
                          {machine.displayName}
                        </div>
                      </div>
                      <span className={`text-[10px] font-semibold px-[7px] py-0.5 rounded-full uppercase tracking-[0.4px] flex-shrink-0 ${isConnected ? 'text-[#16a34a] bg-[rgba(220,252,231,0.8)]' : 'text-[#64748b] bg-[rgba(241,245,249,0.8)]'}`}>
                        {isConnected ? 'Live' : 'Offline'}
                      </span>
                    </div>
                    <div className="flex gap-[10px]">
                      <span className="text-[11px] text-(--color-muted) flex items-center gap-[3px]">
                        <Activity size={11} /> {machine.protocol.toUpperCase()}
                      </span>
                      <span className="text-[11px] text-(--color-muted)">
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
            <div className="bg-(--color-main-bg) rounded-2xl px-8 py-7 shadow-(--shadow-ring) h-fit">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="font-display font-light text-[26px] leading-[1.2] text-(--color-primary) tracking-[-0.3px] mb-2">
                    {selected.name}
                  </h2>
                  <div className="flex gap-[6px] flex-wrap">
                    {[selected.brand, selected.protocol.toUpperCase(), ...selected.capabilities].map(tag => (
                      <span key={tag} className="text-[11px] font-semibold text-(--color-secondary) bg-(--color-surface) px-[9px] py-[3px] rounded-full shadow-(--shadow-inset)">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => removeMachine(selected.id)}
                    className="w-9 h-9 rounded-[10px] border-none bg-(--color-surface) text-(--color-muted) flex items-center justify-center cursor-pointer shadow-(--shadow-inset)"
                    title="Remove machine"
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>

              {/* Temperature cards (when connected) */}
              {isThisMachineConnected(selected) && temps ? (
                <div className="grid grid-cols-3 gap-[14px] mb-6">
                  {[
                    { label: 'Bean Temp', value: temps.bt != null ? `${temps.bt}°C` : '—', sub: 'BT' },
                    { label: 'Env Temp', value: temps.et != null ? `${temps.et}°C` : '—', sub: 'ET' },
                    { label: 'RoR', value: `${temps.ror} °C/min`, sub: 'Rate of Rise' },
                  ].map(s => (
                    <div key={s.label} className="bg-(--color-surface) px-4 py-[14px] rounded-[12px] shadow-(--shadow-inset)">
                      <div className="text-[10px] font-semibold text-(--color-muted) uppercase tracking-[0.5px] mb-[6px]">{s.label}</div>
                      <div className="text-[22px] font-light text-(--color-primary) tracking-[-0.3px]">{s.value}</div>
                      <div className="text-[11px] text-(--color-muted) mt-0.5">{s.sub}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-(--color-surface) rounded-[12px] px-4 py-5 mb-6 flex items-center gap-3 shadow-(--shadow-inset)">
                  {isThisMachineConnected(selected)
                    ? <Wifi size={18} color="#16a34a" />
                    : <WifiOff size={18} color="var(--color-muted)" />}
                  <span className="text-[13px] text-(--color-muted)">
                    {isThisMachineConnected(selected)
                      ? 'Connected — waiting for data...'
                      : 'Not connected. Press Connect to start.'}
                  </span>
                </div>
              )}

              {/* Connection params */}
              {Object.keys(selected.connectionParams).length > 0 && (
                <div className="bg-(--color-surface-warm-solid) rounded-[12px] px-[18px] py-4 mb-6 shadow-(--shadow-warm)">
                  <div className="text-[12px] font-semibold text-(--color-secondary) mb-[10px]">
                    Connection
                  </div>
                  <div className="grid gap-[6px]">
                    {Object.entries(selected.connectionParams).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 px-[10px] py-[7px] rounded-[10px] bg-white/82 shadow-(--shadow-inset)">
                        <span className="text-[11px] text-(--color-muted) uppercase tracking-[0.05em]">{k}</span>
                        <span className="text-[12px] font-semibold text-(--color-primary)">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {sidecarStatus?.error && isThisMachineConnected(selected) && (
                <div className="flex items-center gap-2 bg-[rgba(192,57,43,0.07)] rounded-[10px] px-[14px] py-[10px] mb-4 text-[12px] text-[#c0392b]">
                  <AlertCircle size={14} />
                  {sidecarStatus.error}
                </div>
              )}

              {/* Connect / Disconnect */}
              <div className="flex gap-[10px]">
                {isThisMachineConnected(selected) ? (
                  <button
                    onClick={handleDisconnect}
                    className="flex-1 py-3 rounded-[12px] border-none bg-(--color-surface) text-(--color-secondary) text-sm font-medium cursor-pointer shadow-(--shadow-inset) flex items-center justify-center gap-2"
                  >
                    <WifiOff size={15} strokeWidth={2} />
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(selected)}
                    disabled={connecting}
                    className={`flex-1 py-3 rounded-[12px] border-none bg-(--color-primary) text-white text-sm font-medium flex items-center justify-center gap-2 shadow-(--shadow-card) ${connecting ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}
                  >
                    {connecting
                      ? <><Activity size={15} /> Connecting...</>
                      : <><Wifi size={15} strokeWidth={2} /> Connect</>}
                  </button>
                )}
              </div>

              {/* Uptime badge */}
              {isThisMachineConnected(selected) && (
                <div className="mt-3 flex items-center gap-[6px] text-[12px] text-[#16a34a]">
                  <CheckCircle2 size={13} />
                  Uptime {sidecarStatus?.uptime}s
                </div>
              )}
            </div>
          ) : (
            <div className="bg-(--color-main-bg) rounded-2xl py-[60px] px-8 shadow-(--shadow-ring) flex items-center justify-center text-(--color-muted) text-sm">
              Select a machine
            </div>
          )}
        </div>
      )}
    </div>
  );
};
