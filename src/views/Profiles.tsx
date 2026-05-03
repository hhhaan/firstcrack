import { Plus, Copy, Pencil, Trash2, MoreHorizontal, Lock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { useState } from 'react';

const generateProfileCurve = (dropTemp: number, duration: number) => {
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
};

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

export const Profiles = () => {
  const [selectedId, setSelectedId] = useState<number>(1);
  const selected = profiles.find(p => p.id === selectedId)!;
  const curveData = generateProfileCurve(selected.dropVal, selected.durationSec);

  return (
    <div className="px-10 py-8 max-w-[1100px] mx-auto">

      {/* Header */}
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="font-display font-light text-[32px] leading-[1.13] text-(--color-primary) tracking-[-0.4px] mb-1">
            Roast Profiles
          </h1>
          <p className="text-sm text-(--color-muted) tracking-[0.14px]">
            {profiles.length} profiles · {profiles.filter(p => p.locked).length} locked
          </p>
        </div>
        <button className="flex items-center gap-2 px-[18px] py-[10px] rounded-full border-none bg-(--color-primary) text-white text-sm font-medium cursor-pointer shadow-(--shadow-card) tracking-[0.14px]">
          <Plus size={15} strokeWidth={2.5} />
          New Profile
        </button>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: '300px 1fr' }}>

        {/* Profile list */}
        <div className="flex flex-col gap-2">
          {profiles.map(profile => {
            const isSelected = selectedId === profile.id;
            return (
              <div
                key={profile.id}
                onClick={() => setSelectedId(profile.id)}
                className={`bg-(--color-main-bg) rounded-[14px] p-4 cursor-pointer transition-all duration-150 ${isSelected ? 'border border-black/8 shadow-[rgba(0,0,0,0.4)_0px_0px_1px,rgba(0,0,0,0.06)_0px_2px_8px]' : 'border border-transparent shadow-(--shadow-ring)'}`}
              >
                {/* Mini sparkline */}
                <div className="h-11 mb-[10px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={generateProfileCurve(profile.dropVal, profile.durationSec)}>
                      <Line
                        dataKey="bt"
                        stroke={isSelected ? 'var(--color-primary)' : '#b3b0aa'}
                        strokeWidth={1.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-[5px] mb-0.5">
                      <span className="text-[13px] font-medium text-(--color-primary) tracking-[0.14px]">
                        {profile.name}
                      </span>
                      {profile.locked && <Lock size={11} strokeWidth={2} color="var(--color-muted)" />}
                    </div>
                    <div className="text-[12px] text-(--color-muted) tracking-[0.14px]">
                      Drop {profile.dropTemp} · {profile.batches} batches
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="bg-(--color-main-bg) rounded-2xl px-8 py-7 shadow-(--shadow-ring)">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-display font-light text-[26px] leading-[1.2] text-(--color-primary) tracking-[-0.3px]">
                  {selected.name}
                </h2>
                {selected.locked && (
                  <div className="flex items-center gap-1 px-[9px] py-[3px] rounded-full bg-(--color-surface) shadow-(--shadow-inset)">
                    <Lock size={11} strokeWidth={2} color="var(--color-muted)" />
                    <span className="text-[11px] font-medium text-(--color-muted) tracking-[0.3px]">Locked</span>
                  </div>
                )}
              </div>
              <p className="text-sm text-(--color-secondary) tracking-[0.14px] leading-[1.5]">
                {selected.description}
              </p>
            </div>
            <div className="flex gap-[6px]">
              {[
                { icon: Copy, label: 'Duplicate' },
                { icon: Pencil, label: 'Edit' },
                { icon: MoreHorizontal, label: 'More' },
              ].map(({ icon: Icon, label }) => (
                <button key={label} title={label} className="w-8 h-8 rounded-lg border-none bg-(--color-surface) flex items-center justify-center cursor-pointer shadow-(--shadow-inset)">
                  <Icon size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                </button>
              ))}
            </div>
          </div>

          {/* Temperature curve chart */}
          <div className="bg-(--color-surface) rounded-xl px-4 pt-4 pb-2 mb-5 shadow-(--shadow-inset)">
            <div className="text-[12px] font-medium text-(--color-muted) tracking-[0.5px] uppercase mb-2">
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
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Total Duration', value: selected.duration },
              { label: 'Drop Temperature', value: selected.dropTemp },
              { label: 'Charge Temperature', value: `${selected.charge_temp}°C` },
              { label: 'Development Time', value: selected.devTime },
              { label: 'Dev/Total %', value: selected.devPct },
              { label: 'Total Batches', value: `${selected.batches} runs` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-(--color-surface) rounded-[10px] px-[14px] py-3 shadow-(--shadow-inset)">
                <div className="text-[11px] font-medium text-(--color-muted) tracking-[0.5px] uppercase mb-1">
                  {label}
                </div>
                <div className="text-sm font-semibold text-(--color-primary) font-mono tracking-[-0.2px]">
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Used for */}
          <div>
            <div className="text-[12px] font-medium text-(--color-muted) tracking-[0.5px] uppercase mb-2">
              Used For
            </div>
            <div className="flex gap-[6px] flex-wrap mb-5">
              {selected.usedFor.map(bean => (
                <span key={bean} className="text-[12px] font-medium text-(--color-secondary) bg-(--color-surface) px-[10px] py-1 rounded-full tracking-[0.14px] shadow-(--shadow-inset)">
                  {bean}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-[10px]">
            <button className="flex-1 py-[10px] rounded-full border-none bg-(--color-primary) text-white text-sm font-medium cursor-pointer tracking-[0.14px] shadow-(--shadow-card)">
              Start with this Profile
            </button>
            <button className="flex items-center gap-[6px] px-5 py-[10px] rounded-full border-none bg-[rgba(254,226,226,0.8)] text-[#dc2626] text-sm font-medium cursor-pointer tracking-[0.14px] shadow-(--shadow-inset)">
              <Trash2 size={14} strokeWidth={2} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
