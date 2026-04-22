import { Plus, Copy, Pencil, Trash2, MoreHorizontal, Lock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { useState } from 'react';

function generateProfileCurve(dropTemp: number, duration: number) {
  const points = [];
  for (let t = 0; t <= duration; t += 30) {
    let bt: number;
    if (t <= 90) {
      bt = 200 - (48 * t / 90);
    } else {
      const remaining = duration - 90;
      const rise = dropTemp - 152;
      const elapsed = t - 90;
      bt = 152 + rise * Math.pow(elapsed / remaining, 0.75);
    }
    points.push({ t, bt: Math.round(bt * 10) / 10 });
  }
  return points;
}

const profiles = [
  {
    id: 1,
    name: 'Signature Light',
    description: 'High clarity light roast. Preserves origin characteristics.',
    duration: '11:30–12:30',
    dropTemp: '193–197°C',
    charge: 200,
    dropVal: 195,
    durationSec: 750,
    charge_temp: 200,
    devTime: '1:30–2:00',
    devPct: '12–15%',
    usedFor: ['Ethiopia Yirgacheffe', 'Kenya AA', 'Panama Gesha'],
    locked: false,
    batches: 34,
  },
  {
    id: 2,
    name: 'Balanced Medium',
    description: 'Approachable medium with sweetness and body balance.',
    duration: '12:30–13:30',
    dropTemp: '200–205°C',
    charge: 200,
    dropVal: 202,
    durationSec: 810,
    charge_temp: 200,
    devTime: '1:45–2:15',
    devPct: '13–16%',
    usedFor: ['Colombia Huila', 'Guatemala Antigua'],
    locked: false,
    batches: 22,
  },
  {
    id: 3,
    name: 'House Medium',
    description: 'Consistent, crowd-pleasing medium. Low variance across batches.',
    duration: '13:30–14:30',
    dropTemp: '207–212°C',
    charge: 196,
    dropVal: 210,
    durationSec: 870,
    charge_temp: 196,
    devTime: '2:00–2:30',
    devPct: '14–17%',
    usedFor: ['Brazil Cerrado', 'Guatemala Antigua'],
    locked: true,
    batches: 58,
  },
  {
    id: 4,
    name: 'Dark Roast',
    description: 'Second crack. Bold, heavy body with low acidity.',
    duration: '14:30–16:00',
    dropTemp: '217–222°C',
    charge: 193,
    dropVal: 220,
    durationSec: 930,
    charge_temp: 193,
    devTime: '2:30–3:30',
    devPct: '17–22%',
    usedFor: ['Brazil Cerrado'],
    locked: false,
    batches: 8,
  },
];

export default function Profiles() {
  const [selectedId, setSelectedId] = useState<number>(1);
  const selected = profiles.find(p => p.id === selectedId)!;
  const curveData = generateProfileCurve(selected.dropVal, selected.durationSec);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>

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
            Roast Profiles
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
            {profiles.length} profiles · {profiles.filter(p => p.locked).length} locked
          </p>
        </div>
        <button style={{
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
        }}>
          <Plus size={15} strokeWidth={2.5} />
          New Profile
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>

        {/* Profile list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {profiles.map(profile => (
            <div
              key={profile.id}
              onClick={() => setSelectedId(profile.id)}
              style={{
                background: 'var(--color-main-bg)',
                borderRadius: 14,
                padding: '16px',
                cursor: 'pointer',
                boxShadow: selectedId === profile.id
                  ? 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.06) 0px 2px 8px'
                  : 'var(--shadow-ring)',
                border: selectedId === profile.id ? '1px solid rgba(0,0,0,0.08)' : '1px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {/* Mini sparkline */}
              <div style={{ height: 44, marginBottom: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={generateProfileCurve(profile.dropVal, profile.durationSec)}>
                    <Line
                      dataKey="bt"
                      stroke={selectedId === profile.id ? 'var(--color-primary)' : '#b3b0aa'}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-primary)', letterSpacing: '0.14px' }}>
                      {profile.name}
                    </span>
                    {profile.locked && (
                      <Lock size={11} strokeWidth={2} color="var(--color-muted)" />
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                    Drop {profile.dropTemp} · {profile.batches} batches
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div style={{
          background: 'var(--color-main-bg)',
          borderRadius: 16,
          padding: '28px 32px',
          boxShadow: 'var(--shadow-ring)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h2 style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 300,
                  fontSize: 26,
                  lineHeight: 1.2,
                  color: 'var(--color-primary)',
                  letterSpacing: '-0.3px',
                }}>
                  {selected.name}
                </h2>
                {selected.locked && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 9px',
                    borderRadius: 9999,
                    background: 'var(--color-surface)',
                    boxShadow: 'var(--shadow-inset)',
                  }}>
                    <Lock size={11} strokeWidth={2} color="var(--color-muted)" />
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.3px' }}>Locked</span>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 14, color: 'var(--color-secondary)', letterSpacing: '0.14px', lineHeight: 1.5 }}>
                {selected.description}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { icon: Copy, label: 'Duplicate' },
                { icon: Pencil, label: 'Edit' },
                { icon: MoreHorizontal, label: 'More' },
              ].map(({ icon: Icon, label }) => (
                <button key={label} title={label} style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--color-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-inset)',
                }}>
                  <Icon size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                </button>
              ))}
            </div>
          </div>

          {/* Temperature curve chart */}
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: 12,
            padding: '16px 16px 8px',
            marginBottom: 20,
            boxShadow: 'var(--shadow-inset)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>
              Profile Curve
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={curveData}>
                <CartesianGrid strokeDasharray="0" />
                <XAxis
                  dataKey="t"
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${Math.floor(v / 60)}m`}
                  interval={Math.floor(curveData.length / 6)}
                  tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-muted)' }}
                />
                <YAxis
                  domain={[140, 230]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-muted)' }}
                  width={32}
                  tickFormatter={v => `${v}°`}
                />
                <Tooltip
                  formatter={(value: unknown) => [`${value}°C`, 'Bean Temp']}
                  labelFormatter={(v: unknown) => { const s = Number(v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }}
                  contentStyle={{
                    background: 'white',
                    border: 'none',
                    borderRadius: 10,
                    boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
                    fontSize: 12,
                    fontFamily: 'var(--font-body)',
                  }}
                />
                <Line
                  dataKey="bt"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--color-primary)', strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Profile parameters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Duration', value: selected.duration },
              { label: 'Drop Temperature', value: selected.dropTemp },
              { label: 'Charge Temperature', value: `${selected.charge_temp}°C` },
              { label: 'Development Time', value: selected.devTime },
              { label: 'Dev/Total %', value: selected.devPct },
              { label: 'Total Batches', value: `${selected.batches} runs` },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background: 'var(--color-surface)',
                borderRadius: 10,
                padding: '12px 14px',
                boxShadow: 'var(--shadow-inset)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.2px' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Used for */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>
              Used For
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
              {selected.usedFor.map(bean => (
                <span key={bean} style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--color-secondary)',
                  background: 'var(--color-surface)',
                  padding: '4px 10px',
                  borderRadius: 9999,
                  letterSpacing: '0.14px',
                  boxShadow: 'var(--shadow-inset)',
                }}>
                  {bean}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 9999,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'white',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              letterSpacing: '0.14px',
              boxShadow: 'var(--shadow-card)',
            }}>
              Start with this Profile
            </button>
            <button style={{
              padding: '10px 20px',
              borderRadius: 9999,
              border: 'none',
              background: 'rgba(254,226,226,0.8)',
              color: '#dc2626',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              letterSpacing: '0.14px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: 'var(--shadow-inset)',
            }}>
              <Trash2 size={14} strokeWidth={2} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
