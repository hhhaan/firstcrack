import { useEffect, useState, type CSSProperties } from 'react';
import { Activity, Cpu, Gauge, Radio, ShieldCheck, Wrench, X } from 'lucide-react';
import ModalShell from '../../../shared/ui/modal-shell/ModalShell';

interface AddMachineModalProps {
  open: boolean;
  onClose: () => void;
}

const machineTypes = ['Drum Roaster', 'Electric Roaster', 'Sample Roaster', 'Cooling Tray'];
const connectionTypes = ['Modbus', 'MQTT', 'Phidget', 'Manual'];

export default function AddMachineModal({ open, onClose }: AddMachineModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'Drum Roaster',
    serial: '',
    capacity: '',
    connection: 'Modbus',
    location: 'Production Floor',
    notes: '',
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFormData({
      name: '',
      type: 'Drum Roaster',
      serial: '',
      capacity: '',
      connection: 'Modbus',
      location: 'Production Floor',
      notes: '',
    });
  }, [open]);

  if (!open) {
    return null;
  }

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid rgba(0,0,0,0.08)',
    background: 'rgba(255,255,255,0.84)',
    boxShadow: 'var(--shadow-inset)',
    fontSize: 14,
    color: 'var(--color-primary)',
    outline: 'none',
  };

  const labelStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-muted)',
    marginBottom: 8,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  };

  return (
    <ModalShell
      onClose={onClose}
      labelledBy="add-machine-modal-title"
      contentStyle={{
        width: 'min(720px, 100%)',
        maxHeight: 'min(860px, calc(100vh - 56px))',
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
      <div
        style={{
          flexShrink: 0,
          background: 'linear-gradient(180deg, rgba(246,243,238,0.9) 0%, rgba(255,255,255,0.72) 100%)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            padding: '24px 30px 18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                background: 'var(--color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                boxShadow: '0 10px 20px rgba(0,0,0,0.12)',
                flexShrink: 0,
              }}
            >
              <Cpu size={22} strokeWidth={1.8} />
            </div>

            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.8)',
                  color: 'var(--color-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.12px',
                  marginBottom: 12,
                  boxShadow: 'var(--shadow-inset)',
                }}
              >
                <ShieldCheck size={14} strokeWidth={1.9} />
                Machine onboarding
              </div>

              <h2
                id="add-machine-modal-title"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 28,
                  lineHeight: 1.05,
                  fontWeight: 400,
                  letterSpacing: '-0.04em',
                  color: 'var(--color-primary)',
                  margin: 0,
                }}
              >
                Add a new machine
              </h2>

              <p
                style={{
                  fontSize: 14,
                  color: 'var(--color-secondary)',
                  marginTop: 10,
                  maxWidth: 460,
                }}
              >
                Register a roaster or peripheral device so the workspace can track health, connection state, and maintenance timing.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close add machine modal"
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
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
            <X size={18} strokeWidth={2.3} />
          </button>
        </div>
      </div>

      <div
        style={{
          padding: 30,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.2fr) minmax(240px, 0.8fr)',
          gap: 20,
        }}
      >
        <section
          style={{
            background: 'linear-gradient(180deg, rgba(250,249,247,0.95) 0%, rgba(255,255,255,0.88) 100%)',
            borderRadius: 22,
            padding: 22,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: 'var(--shadow-warm)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 18,
          }}
        >
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>
              <Cpu size={14} />
              Machine Name
            </label>
            <input
              style={inputStyle}
              placeholder="e.g. Giesen W15A"
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>
              <Wrench size={14} />
              Type
            </label>
            <select
              style={inputStyle}
              value={formData.type}
              onChange={(event) => setFormData({ ...formData, type: event.target.value })}
            >
              {machineTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>
              <Gauge size={14} />
              Capacity
            </label>
            <input
              style={inputStyle}
              placeholder="e.g. 15kg"
              value={formData.capacity}
              onChange={(event) => setFormData({ ...formData, capacity: event.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>
              <Activity size={14} />
              Serial Number
            </label>
            <input
              style={inputStyle}
              placeholder="e.g. GSN-2026-014"
              value={formData.serial}
              onChange={(event) => setFormData({ ...formData, serial: event.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>
              <Radio size={14} />
              Connection
            </label>
            <select
              style={inputStyle}
              value={formData.connection}
              onChange={(event) => setFormData({ ...formData, connection: event.target.value })}
            >
              {connectionTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>
              <ShieldCheck size={14} />
              Install Location
            </label>
            <input
              style={inputStyle}
              placeholder="e.g. Production Floor"
              value={formData.location}
              onChange={(event) => setFormData({ ...formData, location: event.target.value })}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>
              <Wrench size={14} />
              Notes
            </label>
            <textarea
              rows={5}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 120 }}
              placeholder="Calibration date, firmware, service reminders, or integration notes."
              value={formData.notes}
              onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
            />
          </div>
        </section>

        <section
          style={{
            display: 'grid',
            gap: 16,
            alignContent: 'start',
          }}
        >
          <div
            style={{
              background: 'var(--color-surface-warm-solid)',
              borderRadius: 20,
              padding: 20,
              boxShadow: 'var(--shadow-warm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.92)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-primary)',
                  boxShadow: 'var(--shadow-ring)',
                }}
              >
                <Radio size={17} strokeWidth={1.9} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary)' }}>Connection preview</div>
                <div style={{ fontSize: 12, color: 'var(--color-secondary)' }}>Ready for device registration</div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {[
                ['Protocol', formData.connection],
                ['Machine type', formData.type],
                ['Zone', formData.location || 'Not set'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.82)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', textAlign: 'right' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              background: 'rgba(248,247,244,0.92)',
              borderRadius: 20,
              padding: 20,
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: 'var(--shadow-ring)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 10 }}>
              Before going live
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {[
                'Verify sensor mapping and incoming telemetry source.',
                'Confirm maintenance cadence after commissioning.',
                'Assign the machine to the correct roasting zone.',
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    fontSize: 13,
                    color: 'var(--color-secondary)',
                    padding: '10px 12px',
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.86)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          padding: '18px 30px 26px',
          borderTop: '1px solid rgba(0,0,0,0.05)',
          background: 'rgba(255,255,255,0.84)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '12px 16px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--color-surface)',
            color: 'var(--color-secondary)',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-inset)',
          }}
        >
          Cancel
        </button>

        <button
          onClick={onClose}
          style={{
            padding: '12px 18px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--color-primary)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          Create Machine
        </button>
      </div>
    </ModalShell>
  );
}
