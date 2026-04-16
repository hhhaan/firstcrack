import { useState } from 'react';
import { Search, Filter, ChevronDown, ChevronUp, Download } from 'lucide-react';

const sessions = [
  { id: 1, date: '2026-04-14', bean: 'Ethiopia Yirgacheffe', origin: 'Ethiopia', process: 'Natural', profile: 'Signature Light', weightIn: 250, weightOut: 213, duration: '12:34', charge: 200, drop: 196, level: 'Light', dev: '1:42', loss: '14.8%', notes: 'Clean and floral. Slight under-development.' },
  { id: 2, date: '2026-04-12', bean: 'Colombia Huila', origin: 'Colombia', process: 'Washed', profile: 'Balanced Medium', weightIn: 500, weightOut: 421, duration: '13:10', charge: 200, drop: 203, level: 'Medium-Light', dev: '1:55', loss: '15.8%', notes: 'Caramel and stone fruit. Good development.' },
  { id: 3, date: '2026-04-10', bean: 'Brazil Cerrado', origin: 'Brazil', process: 'Natural', profile: 'House Medium', weightIn: 1000, weightOut: 840, duration: '14:20', charge: 195, drop: 211, level: 'Medium', dev: '2:10', loss: '16.0%', notes: 'Nutty and chocolatey. Consistent batch.' },
  { id: 4, date: '2026-04-08', bean: 'Kenya AA', origin: 'Kenya', process: 'Washed', profile: 'Signature Light', weightIn: 250, weightOut: 211, duration: '11:55', charge: 200, drop: 193, level: 'Light', dev: '1:35', loss: '15.6%', notes: 'Bright citrus. Slightly high ROR peak.' },
  { id: 5, date: '2026-04-06', bean: 'Guatemala Antigua', origin: 'Guatemala', process: 'Honey', profile: 'House Medium', weightIn: 500, weightOut: 419, duration: '13:45', charge: 198, drop: 208, level: 'Medium', dev: '2:05', loss: '16.2%', notes: 'Sweet and balanced. Best batch so far.' },
  { id: 6, date: '2026-04-03', bean: 'Panama Gesha', origin: 'Panama', process: 'Natural', profile: 'Signature Light', weightIn: 200, weightOut: 170, duration: '12:15', charge: 198, drop: 194, level: 'Light', dev: '1:50', loss: '15.0%', notes: 'Jasmine and peach. Exceptional lot.' },
  { id: 7, date: '2026-03-31', bean: 'Ethiopia Yirgacheffe', origin: 'Ethiopia', process: 'Natural', profile: 'Signature Light', weightIn: 250, weightOut: 212, duration: '12:22', charge: 200, drop: 195, level: 'Light', dev: '1:45', loss: '15.2%', notes: '' },
  { id: 8, date: '2026-03-28', bean: 'Colombia Huila', origin: 'Colombia', process: 'Washed', profile: 'Balanced Medium', weightIn: 1000, weightOut: 843, duration: '13:05', charge: 200, drop: 202, level: 'Medium-Light', dev: '1:52', loss: '15.7%', notes: 'Consistent result.' },
];

const levelColor: Record<string, string> = {
  'Light': '#a16207',
  'Medium-Light': '#92400e',
  'Medium': '#7c2d12',
};

const levelBg: Record<string, string> = {
  'Light': 'rgba(254,243,199,0.8)',
  'Medium-Light': 'rgba(254,231,200,0.8)',
  'Medium': 'rgba(253,220,198,0.8)',
};

type SortKey = 'date' | 'bean' | 'duration' | 'drop' | 'level';

export default function History() {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = sessions
    .filter(s =>
      s.bean.toLowerCase().includes(search.toLowerCase()) ||
      s.profile.toLowerCase().includes(search.toLowerCase()) ||
      s.origin.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      if (sortKey === 'date') return dir * (a.date < b.date ? -1 : 1);
      if (sortKey === 'bean') return dir * a.bean.localeCompare(b.bean);
      if (sortKey === 'duration') return dir * (a.duration < b.duration ? -1 : 1);
      if (sortKey === 'drop') return dir * (a.drop - b.drop);
      return dir * a.level.localeCompare(b.level);
    });

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown size={11} strokeWidth={2} color="var(--text-muted)" style={{ opacity: 0.4 }} />;
    return sortAsc
      ? <ChevronUp size={11} strokeWidth={2.5} color="var(--text-primary)" />
      : <ChevronDown size={11} strokeWidth={2.5} color="var(--text-primary)" />;
  };

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
            color: 'var(--text-primary)',
            letterSpacing: '-0.4px',
            marginBottom: 4,
          }}>
            Roast History
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
            {sessions.length} sessions recorded
          </p>
        </div>
        <button style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '9px 16px',
          borderRadius: 9999,
          border: 'none',
          background: 'var(--bg)',
          color: 'var(--text-secondary)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          boxShadow: 'var(--shadow-card)',
          letterSpacing: '0.14px',
        }}>
          <Download size={14} strokeWidth={2} />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{
        background: 'var(--bg)',
        borderRadius: 16,
        padding: '16px 20px',
        boxShadow: 'var(--shadow-ring)',
        marginBottom: 16,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          padding: '8px 12px',
          boxShadow: 'var(--shadow-inset)',
        }}>
          <Search size={14} strokeWidth={2} color="var(--text-muted)" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by bean, profile, or origin..."
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: 13,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)',
              width: '100%',
              letterSpacing: '0.14px',
            }}
          />
        </div>
        {['All Levels', 'All Origins', 'This Month'].map(label => (
          <button key={label} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-inset)',
            letterSpacing: '0.14px',
            whiteSpace: 'nowrap',
          }}>
            <Filter size={12} strokeWidth={2} color="var(--text-muted)" />
            {label}
            <ChevronDown size={11} strokeWidth={2} color="var(--text-muted)" />
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--bg)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-ring)',
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {[
                { key: 'date', label: 'Date' },
                { key: 'bean', label: 'Bean' },
                { key: null, label: 'Profile' },
                { key: null, label: 'Weight' },
                { key: 'drop', label: 'Drop' },
                { key: 'duration', label: 'Duration' },
                { key: null, label: 'Dev' },
                { key: null, label: 'Loss' },
                { key: 'level', label: 'Level' },
              ].map(({ key, label }) => (
                <th
                  key={label}
                  onClick={() => key && handleSort(key as SortKey)}
                  style={{
                    padding: '12px 20px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    cursor: key ? 'pointer' : 'default',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {label}
                    {key && <SortIcon col={key as SortKey} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((session) => (
              <>
                <tr
                  key={session.id}
                  onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    background: expandedId === session.id ? 'rgba(245,245,245,0.5)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                    {session.date.slice(5)}
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px', whiteSpace: 'nowrap' }}>
                    {session.bean}
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '0.14px', whiteSpace: 'nowrap' }}>
                    {session.profile}
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {session.weightIn}g → {session.weightOut}g
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {session.drop}°C
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {session.duration}
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {session.dev}
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {session.loss}
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: levelColor[session.level] || 'var(--text-muted)',
                      background: levelBg[session.level] || 'var(--bg-secondary)',
                      padding: '3px 8px',
                      borderRadius: 9999,
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.14px',
                    }}>
                      {session.level}
                    </span>
                  </td>
                </tr>
                {expandedId === session.id && (
                  <tr key={`${session.id}-detail`} style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(245,242,239,0.3)' }}>
                    <td colSpan={9} style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 2fr', gap: 16, alignItems: 'start' }}>
                        {[
                          { label: 'Origin', value: session.origin },
                          { label: 'Process', value: session.process },
                          { label: 'Charge Temp', value: `${session.charge}°C` },
                          { label: 'Development %', value: `${((parseInt(session.dev) + parseInt(session.dev.split(':')[1]) / 60) / (parseInt(session.duration) + parseInt(session.duration.split(':')[1]) / 60) * 100).toFixed(1)}%` },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.14px' }}>{value}</div>
                          </div>
                        ))}
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 3 }}>Notes</div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '0.14px', lineHeight: 1.5 }}>
                            {session.notes || <span style={{ color: 'var(--text-muted)' }}>No notes recorded.</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>

        <div style={{
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
            Showing {filtered.length} of {sessions.length} sessions
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3].map(p => (
              <button key={p} style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: p === 1 ? 'var(--text-primary)' : 'var(--bg-secondary)',
                color: p === 1 ? 'white' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: p === 1 ? 'none' : 'var(--shadow-inset)',
              }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
