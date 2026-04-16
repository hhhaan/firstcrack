import { LayoutDashboard, Flame, ClipboardList, Coffee, BookOpen, Settings, ChevronDown } from 'lucide-react';
import { View } from '../App';

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
}

const navItems: { id: View; label: string; icon: React.FC<{ size?: number; strokeWidth?: number; color?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'roast', label: 'Active Roast', icon: Flame },
  { id: 'history', label: 'Roast History', icon: ClipboardList },
  { id: 'beans', label: 'Bean Inventory', icon: Coffee },
  { id: 'profiles', label: 'Profiles', icon: BookOpen },
];

export default function Sidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <aside style={{
      width: 240,
      flexShrink: 0,
      height: '100vh',
      background: 'var(--bg)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
              <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
              <line x1="6" x2="6" y1="2" y2="4" />
              <line x1="10" x2="10" y1="2" y2="4" />
              <line x1="14" x2="14" y1="2" y2="4" />
            </svg>
          </div>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 300,
              fontSize: 16,
              lineHeight: 1.2,
              color: 'var(--text-primary)',
              letterSpacing: '-0.2px',
            }}>
              First Crack
            </div>
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              letterSpacing: '0.14px',
              fontWeight: 500,
            }}>
              Roastery Dashboard
            </div>
          </div>
        </div>
      </div>

      {/* Workspace selector */}
      <div style={{ padding: '12px 12px 8px' }}>
        <button
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--bg-secondary)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-inset)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: 'var(--bg-warm-solid)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}>
              BW
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px' }}>
              Brewlab Works
            </span>
          </div>
          <ChevronDown size={14} strokeWidth={2} color="var(--text-muted)" />
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '4px 12px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 4 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-muted)',
            letterSpacing: '0.7px',
            textTransform: 'uppercase',
            padding: '8px 10px 4px',
          }}>
            Workspace
          </div>
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activeView === id;
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  marginBottom: 2,
                  background: isActive ? 'var(--bg-secondary)' : 'transparent',
                  boxShadow: isActive ? 'var(--shadow-inset)' : 'none',
                  transition: 'background 0.15s',
                }}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2 : 1.5}
                  color={isActive ? 'var(--text-primary)' : 'var(--text-muted)'}
                />
                <span style={{
                  fontSize: 14,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  letterSpacing: '0.14px',
                }}>
                  {label}
                </span>
                {id === 'roast' && (
                  <div style={{
                    marginLeft: 'auto',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#22c55e',
                    boxShadow: '0 0 0 2px rgba(34,197,94,0.2)',
                    flexShrink: 0,
                  }} />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Bottom user section */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <button style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          borderRadius: 8,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
        }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--bg-warm-solid)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            flexShrink: 0,
            boxShadow: 'var(--shadow-inset)',
          }}>
            JK
          </div>
          <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px' }}>
              Jake Kim
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Head Roaster
            </div>
          </div>
          <Settings size={14} strokeWidth={1.5} color="var(--text-muted)" />
        </button>
      </div>
    </aside>
  );
}
