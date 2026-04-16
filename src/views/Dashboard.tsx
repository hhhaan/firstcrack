import { TrendingUp, Coffee, Clock, CheckCircle, ArrowRight, Calendar, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { View } from '../App';

interface DashboardProps {
  onNavigate: (view: View) => void;
}

const monthlyData = [
  { month: 'Nov', batches: 18 },
  { month: 'Dec', batches: 24 },
  { month: 'Jan', batches: 21 },
  { month: 'Feb', batches: 29 },
  { month: 'Mar', batches: 26 },
  { month: 'Apr', batches: 14 },
];

const recentSessions = [
  { id: 1, date: 'Apr 14', bean: 'Ethiopia Yirgacheffe', profile: 'Signature Light', weight: '250g', drop: '196°C', duration: '12:34', level: 'Light' },
  { id: 2, date: 'Apr 12', bean: 'Colombia Huila', profile: 'Balanced Medium', weight: '500g', drop: '203°C', duration: '13:10', level: 'Medium-Light' },
  { id: 3, date: 'Apr 10', bean: 'Brazil Cerrado', profile: 'House Medium', weight: '1000g', drop: '211°C', duration: '14:20', level: 'Medium' },
  { id: 4, date: 'Apr 8', bean: 'Kenya AA', profile: 'Signature Light', weight: '250g', drop: '193°C', duration: '11:55', level: 'Light' },
  { id: 5, date: 'Apr 6', bean: 'Guatemala Antigua', profile: 'House Medium', weight: '500g', drop: '208°C', duration: '13:45', level: 'Medium' },
];

const levelColor: Record<string, string> = {
  'Light': '#a16207',
  'Medium-Light': '#92400e',
  'Medium': '#7c2d12',
  'Medium-Dark': '#431407',
  'Dark': '#1c0a00',
};

const levelBg: Record<string, string> = {
  'Light': 'rgba(254,243,199,0.8)',
  'Medium-Light': 'rgba(254,231,200,0.8)',
  'Medium': 'rgba(253,220,198,0.8)',
  'Medium-Dark': 'rgba(240,180,150,0.8)',
  'Dark': 'rgba(220,140,100,0.8)',
};

const stats = [
  { label: 'Batches This Month', value: '14', change: '+17%', icon: Coffee },
  { label: 'Beans Roasted', value: '8.4 kg', change: '+9%', icon: TrendingUp },
  { label: 'Avg Roast Time', value: '13:08', change: '-0:42', icon: Clock },
  { label: 'Success Rate', value: '96%', change: '+2%', icon: CheckCircle },
];

export default function Dashboard({ onNavigate }: DashboardProps) {
  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 300,
            fontSize: 32,
            lineHeight: 1.13,
            color: 'var(--text-primary)',
            letterSpacing: '-0.4px',
            marginBottom: 6,
          }}>
            Good morning, Jake
          </h1>
          <p style={{
            fontSize: 15,
            color: 'var(--text-secondary)',
            letterSpacing: '0.15px',
            fontWeight: 400,
          }}>
            Wednesday, April 16 · 1 roast in progress
          </p>
        </div>
        <button
          onClick={() => onNavigate('roast')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 9999,
            border: 'none',
            background: 'var(--text-primary)',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            letterSpacing: '0.14px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
          View Active Roast
          <ArrowRight size={14} strokeWidth={2} />
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {stats.map(({ label, value, change, icon: Icon }) => {
          const isPositive = change.startsWith('+');
          return (
            <div key={label} style={{
              background: 'var(--bg)',
              borderRadius: 16,
              padding: '20px 20px 18px',
              boxShadow: 'var(--shadow-ring)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: 'var(--bg-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--shadow-inset)',
                }}>
                  <Icon size={16} strokeWidth={1.5} color="var(--text-secondary)" />
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: isPositive ? '#16a34a' : '#dc2626',
                  background: isPositive ? 'rgba(220,252,231,0.8)' : 'rgba(254,226,226,0.8)',
                  padding: '2px 8px',
                  borderRadius: 9999,
                  letterSpacing: '0.14px',
                }}>
                  {change}
                </span>
              </div>
              <div style={{
                fontSize: 26,
                fontWeight: 600,
                color: 'var(--text-primary)',
                lineHeight: 1.2,
                marginBottom: 4,
                letterSpacing: '-0.5px',
              }}>
                {value}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
                {label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginBottom: 20 }}>

        {/* Recent Sessions */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-ring)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '18px 24px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <h2 style={{
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--text-primary)',
              letterSpacing: '0.15px',
            }}>
              Recent Sessions
            </h2>
            <button
              onClick={() => onNavigate('history')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                letterSpacing: '0.14px',
              }}
            >
              View all <ChevronRight size={13} strokeWidth={2} />
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Date', 'Bean', 'Profile', 'Weight', 'Drop Temp', 'Duration', 'Level'].map(h => (
                  <th key={h} style={{
                    padding: '10px 24px 10px',
                    textAlign: 'left',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSessions.map((session, i) => (
                <tr key={session.id} style={{
                  borderBottom: i < recentSessions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}>
                  <td style={{ padding: '12px 24px', fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, whiteSpace: 'nowrap' }}>
                    {session.date}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, letterSpacing: '0.14px', whiteSpace: 'nowrap' }}>
                    {session.bean}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '0.14px', whiteSpace: 'nowrap' }}>
                    {session.profile}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {session.weight}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {session.drop}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {session.duration}
                  </td>
                  <td style={{ padding: '12px 24px' }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: levelColor[session.level] || 'var(--text-muted)',
                      background: levelBg[session.level] || 'var(--bg-secondary)',
                      padding: '3px 8px',
                      borderRadius: 9999,
                      letterSpacing: '0.14px',
                      whiteSpace: 'nowrap',
                    }}>
                      {session.level}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Monthly chart */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '20px 24px',
          boxShadow: 'var(--shadow-ring)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}>
            <h2 style={{
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--text-primary)',
              letterSpacing: '0.15px',
            }}>
              Monthly Batches
            </h2>
            <Calendar size={15} strokeWidth={1.5} color="var(--text-muted)" />
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={monthlyData} barSize={20}>
              <CartesianGrid vertical={false} strokeDasharray="0" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fontFamily: 'var(--font-body)', fill: 'var(--text-muted)' }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fontFamily: 'var(--font-body)', fill: 'var(--text-muted)' }}
                width={28}
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                contentStyle={{
                  background: 'white',
                  border: 'none',
                  borderRadius: 10,
                  boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
                  fontSize: 13,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <Bar dataKey="batches" fill="var(--text-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <div style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.5px', textTransform: 'uppercase', fontWeight: 500 }}>
              This Month
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>14</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>batches</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>8.4</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>kg roasted</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>3</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>bean origins</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming + Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Upcoming */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '20px 24px',
          boxShadow: 'var(--shadow-ring)',
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.15px', marginBottom: 14 }}>
            Upcoming Batches
          </h2>
          {[
            { time: 'Today, 2:00 PM', bean: 'Panama Gesha', weight: '200g', profile: 'Signature Light' },
            { time: 'Today, 4:30 PM', bean: 'Ethiopia Yirgacheffe', weight: '500g', profile: 'Signature Light' },
            { time: 'Tomorrow, 10:00 AM', bean: 'Colombia Huila', weight: '1kg', profile: 'Balanced Medium' },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: i < 2 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: 'var(--bg-warm-solid)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: 'var(--shadow-inset)',
              }}>
                <Calendar size={14} strokeWidth={1.5} color="var(--text-secondary)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px' }}>
                  {item.bean}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
                  {item.time} · {item.weight} · {item.profile}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Low stock alert */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '20px 24px',
          boxShadow: 'var(--shadow-ring)',
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.15px', marginBottom: 14 }}>
            Inventory Alerts
          </h2>
          {[
            { bean: 'Brazil Cerrado', stock: '890g', status: 'Low Stock', color: '#d97706', bg: 'rgba(254,243,199,0.8)' },
            { bean: 'Panama Gesha', stock: '500g', status: 'Low Stock', color: '#d97706', bg: 'rgba(254,243,199,0.8)' },
            { bean: 'Guatemala Antigua', stock: '0g', status: 'Out of Stock', color: '#dc2626', bg: 'rgba(254,226,226,0.8)' },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: i < 2 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: item.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Coffee size={14} strokeWidth={1.5} color={item.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px' }}>
                  {item.bean}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
                  {item.stock} remaining
                </div>
              </div>
              <span style={{
                fontSize: 11,
                fontWeight: 500,
                color: item.color,
                background: item.bg,
                padding: '3px 8px',
                borderRadius: 9999,
                letterSpacing: '0.14px',
                whiteSpace: 'nowrap',
              }}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
