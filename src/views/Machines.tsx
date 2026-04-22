import { Plus, Search, Cpu, Zap, Activity, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import AddMachineModal from '../widgets/add-machine-modal/ui/AddMachineModal';

const machines = [
  {
    id: 1,
    name: 'Giesen W6A',
    type: 'Drum Roaster',
    serial: 'SN-2024-001',
    capacity: '6kg',
    lastMaintenance: '2026-03-15',
    nextMaintenance: '2026-06-15',
    status: 'Online',
    temp: 205.4,
    pressure: 1.2,
    hours: 842,
  },
  {
    id: 2,
    name: 'Stronghold S7 Pro',
    type: 'Electric Roaster',
    serial: 'SH-772-B',
    capacity: '850g',
    lastMaintenance: '2026-04-01',
    nextMaintenance: '2026-07-01',
    status: 'Maintenance',
    temp: 0,
    pressure: 0,
    hours: 215,
  },
  {
    id: 3,
    name: 'Sample Roaster V1',
    type: 'Sample Roaster',
    serial: 'SMPL-09',
    capacity: '100g',
    lastMaintenance: '2026-02-10',
    nextMaintenance: '2026-05-10',
    status: 'Offline',
    temp: 0,
    pressure: 0,
    hours: 128,
  },
];

const statusConfig = {
  Online: { color: '#16a34a', bg: 'rgba(220,252,231,0.8)', icon: CheckCircle2, label: 'Running' },
  Maintenance: { color: '#d97706', bg: 'rgba(254,243,199,0.8)', icon: AlertCircle, label: 'Warning' },
  Offline: { color: '#64748b', bg: 'rgba(241,245,249,0.8)', icon: Zap, label: 'Idle' },
};

export default function Machines() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(1);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const filtered = machines.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.type.toLowerCase().includes(search.toLowerCase())
  );

  const selected = machines.find(m => m.id === selectedId);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      <AddMachineModal open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 300,
            fontSize: 32,
            lineHeight: 1.13,
            color: 'var(--color-primary)',
            letterSpacing: '-0.4px',
            marginBottom: 4,
          }}>
            Machine Inventory
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
            {machines.filter(m => m.status === 'Online').length} active · {machines.filter(m => m.status === 'Maintenance').length} maintenance · {machines.filter(m => m.status === 'Offline').length} offline
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 9999,
            border: 'none',
            background: 'var(--color-primary)',
            color: 'white',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-card)',
            letterSpacing: '0.14px',
          }}
        >
          <Plus size={15} strokeWidth={2.5} />
          Add Machine
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>

        {/* Machine list */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--color-main-bg)',
            borderRadius: 10,
            padding: '9px 12px',
            marginBottom: 10,
            boxShadow: 'var(--shadow-ring)',
          }}>
            <Search size={14} strokeWidth={2} color="var(--color-muted)" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search machines..."
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 13,
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-body)',
                width: '100%',
                letterSpacing: '0.14px',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(machine => {
              const cfg = statusConfig[machine.status as keyof typeof statusConfig];
              const isSelected = selectedId === machine.id;

              return (
                <div
                  key={machine.id}
                  onClick={() => setSelectedId(machine.id)}
                  style={{
                    background: 'var(--color-main-bg)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    cursor: 'pointer',
                    boxShadow: isSelected ? 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.06) 0px 2px 8px' : 'var(--shadow-ring)',
                    border: isSelected ? '1px solid rgba(0,0,0,0.08)' : '1px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-primary)', letterSpacing: '0.14px', marginBottom: 2 }}>
                        {machine.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                        {machine.type}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: cfg.color,
                      background: cfg.bg,
                      padding: '2px 7px',
                      borderRadius: 9999,
                      flexShrink: 0,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px'
                    }}>
                      {machine.status}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Activity size={12} /> {machine.hours}h
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Cpu size={12} /> {machine.capacity}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selected ? (
          <div style={{
            background: 'var(--color-main-bg)',
            borderRadius: 16,
            padding: '28px 32px',
            boxShadow: 'var(--shadow-ring)',
            height: 'fit-content',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h2 style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 300,
                  fontSize: 26,
                  lineHeight: 1.2,
                  color: 'var(--color-primary)',
                  letterSpacing: '-0.3px',
                  marginBottom: 4,
                }}>
                  {selected.name}
                </h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--color-secondary)',
                    background: 'var(--color-surface)',
                    padding: '3px 9px',
                    borderRadius: 9999,
                    boxShadow: 'var(--shadow-inset)',
                  }}>
                    {selected.serial}
                  </span>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--color-secondary)',
                    background: 'var(--color-surface)',
                    padding: '3px 9px',
                    borderRadius: 9999,
                    boxShadow: 'var(--shadow-inset)',
                  }}>
                    {selected.type}
                  </span>
                </div>
              </div>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: 'var(--color-surface-warm-solid)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-warm)',
              }}>
                <Cpu size={22} strokeWidth={1.5} color="var(--color-secondary)" />
              </div>
            </div>

            {/* Stats section */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
               {[
                 { label: 'Air Temp', value: `${selected.temp}°C`, sub: 'Current' },
                 { label: 'Gas Pressure', value: `${selected.pressure} kPa`, sub: 'Incoming' },
                 { label: 'Total Usage', value: `${selected.hours}h`, sub: 'Total time' },
               ].map((stat, i) => (
                 <div key={i} style={{
                   background: 'var(--color-surface)',
                   padding: '16px',
                   borderRadius: 12,
                   boxShadow: 'var(--shadow-inset)',
                 }}>
                   <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                     {stat.label}
                   </div>
                   <div style={{ fontSize: 20, fontWeight: 300, color: 'var(--color-primary)', letterSpacing: '-0.3px' }}>
                     {stat.value}
                   </div>
                   <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                     {stat.sub}
                   </div>
                 </div>
               ))}
            </div>

            {/* Maintenance Info */}
            <div style={{ 
              background: 'var(--color-surface-warm-solid)', 
              borderRadius: 12, 
              padding: '20px', 
              marginBottom: 32,
              boxShadow: 'var(--shadow-warm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Activity size={16} color="var(--color-secondary)" />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-secondary)' }}>Maintenance Schedule</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                    Last Service
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--color-primary)', fontWeight: 500 }}>
                    {selected.lastMaintenance}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                    Next Scheduled
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--color-primary)', fontWeight: 500 }}>
                    {selected.nextMaintenance}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12 }}>
              <button style={{
                flex: 1,
                padding: '12px 0',
                borderRadius: 12,
                border: 'none',
                background: 'var(--color-primary)',
                color: 'white',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: 'var(--shadow-card)',
              }}>
                Run Diagnostic
              </button>
              <button style={{
                flex: 1,
                padding: '12px 0',
                borderRadius: 12,
                border: 'none',
                background: 'var(--color-surface)',
                color: 'var(--color-secondary)',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: 'var(--shadow-inset)',
              }}>
                Service Log
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            background: 'var(--color-main-bg)',
            borderRadius: 16,
            padding: '60px 32px',
            boxShadow: 'var(--shadow-ring)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-muted)',
            fontSize: 14,
          }}>
            Select a machine to view diagnostics
          </div>
        )}
      </div>
    </div>
  );
}
