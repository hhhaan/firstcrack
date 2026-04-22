import { useEffect, useState, type CSSProperties } from 'react';
import { Bell, Database, Gauge, LayoutDashboard, PlayCircle, Shield, X } from 'lucide-react';
import ModalShell from '../../../shared/ui/modal-shell/ModalShell';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTabId = 'general' | 'notifications' | 'session' | 'system';

const tabs: {
  id: SettingsTabId;
  label: string;
  icon: typeof LayoutDashboard;
  title: string;
  description: string;
  cards: Array<{
    title: string;
    description: string;
    items: string[];
  }>;
}[] = [
  {
    id: 'general',
    label: 'General',
    icon: LayoutDashboard,
    title: 'Workspace preferences',
    description: 'Control the app-wide defaults that shape how the roastery workspace feels day to day.',
    cards: [
      {
        title: 'Interface',
        description: 'Lightweight preferences that apply across the whole app.',
        items: ['Default landing view', 'Temperature unit', 'Weight unit'],
      },
      {
        title: 'Display defaults',
        description: 'Keep the dashboard and navigation behavior consistent between sessions.',
        items: ['Expanded sidebar by default', 'Show live metrics panel', 'Use compact data cards'],
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    title: 'Alerts and reminders',
    description: 'Choose which messages need your attention without duplicating workflow screens from the sidebar.',
    cards: [
      {
        title: 'Operational alerts',
        description: 'Useful prompts during roasting and equipment monitoring.',
        items: ['Roast milestone alerts', 'Machine disconnect warning', 'Maintenance reminder'],
      },
      {
        title: 'Delivery style',
        description: 'How the app should surface notifications while you work.',
        items: ['Banner notifications', 'Sound alerts', 'Only high-priority alerts'],
      },
    ],
  },
  {
    id: 'session',
    label: 'Session',
    icon: PlayCircle,
    title: 'Roast session behavior',
    description: 'Set the small workflow defaults that affect each roast session from start to finish.',
    cards: [
      {
        title: 'Session start',
        description: 'Automations that help the operator begin quickly.',
        items: ['Auto-start roast timer', 'Open active roast view immediately', 'Confirm before starting session'],
      },
      {
        title: 'Session end',
        description: 'Consistency for summaries and final review.',
        items: ['Show roast summary after end', 'Confirm before discarding session', 'Keep roast notes visible'],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Database,
    title: 'System and data',
    description: 'A home for global app actions, local data health, and export-related controls.',
    cards: [
      {
        title: 'Data controls',
        description: 'Workspace-level actions that do not belong to beans, machines, or profiles directly.',
        items: ['Export current workspace data', 'Create local backup snapshot', 'Preserve activity logs'],
      },
      {
        title: 'Environment',
        description: 'Status and safety-oriented preferences for the app itself.',
        items: ['Show connection health badge', 'Check local device services', 'Require confirmation for resets'],
      },
    ],
  },
];

const tabButtonStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '12px 14px',
  borderRadius: 14,
  border: 'none',
  cursor: 'pointer',
  background: active ? 'rgba(255,255,255,0.96)' : 'transparent',
  color: active ? 'var(--color-primary)' : 'var(--color-secondary)',
  boxShadow: active ? 'var(--shadow-card)' : 'none',
  textAlign: 'left',
  transition: 'all 0.18s ease',
});

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');

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
    if (open) {
      setActiveTab('general');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const activeConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const ActiveIcon = activeConfig.icon;

  return (
    <ModalShell
      onClose={onClose}
      labelledBy="settings-modal-title"
      contentStyle={{
        width: 'min(920px, 100%)',
        maxHeight: 'min(780px, calc(100vh - 48px))',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 24,
        background: 'rgba(255,255,255,0.95)',
        boxShadow: '0 24px 60px rgba(22, 18, 12, 0.2)',
        border: '1px solid rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '28px 28px 20px',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'linear-gradient(180deg, rgba(248,245,240,0.72) 0%, rgba(255,255,255,0.92) 100%)',
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 999,
              background: 'var(--color-surface-warm-solid)',
              color: 'var(--color-secondary)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.12px',
              marginBottom: 14,
            }}
          >
            <Shield size={14} strokeWidth={1.8} />
            Workspace settings
          </div>
          <h2 id="settings-modal-title" style={{ margin: 0, fontSize: 0, lineHeight: 0 }}>
            Workspace settings
          </h2>
        </div>

        <button
          onClick={onClose}
          aria-label="Close settings"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
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
          <X size={16} strokeWidth={1.9} />
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '240px minmax(0, 1fr)',
          minHeight: 0,
          flex: 1,
        }}
      >
        <aside
          style={{
            padding: 20,
            borderRight: '1px solid var(--color-border-subtle)',
            background: 'rgba(247,244,240,0.64)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: 8,
              padding: 6,
              borderRadius: 20,
              background: 'rgba(255,255,255,0.55)',
              boxShadow: 'var(--shadow-inset)',
            }}
          >
            {tabs.map(({ id, label, icon: Icon }) => {
              const active = id === activeTab;

              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  style={tabButtonStyle(active)}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: active ? 'var(--color-surface-warm-solid)' : 'rgba(255,255,255,0.72)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: active ? 'var(--color-primary)' : 'var(--color-muted)',
                      boxShadow: 'var(--shadow-inset)',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.12px' }}>{label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div
          style={{
            padding: 24,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: 'var(--color-surface-warm-solid)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary)',
                boxShadow: 'var(--shadow-warm)',
                flexShrink: 0,
              }}
            >
              <ActiveIcon size={20} strokeWidth={1.9} />
            </div>
            <div>
              <h3
                style={{
                  fontSize: 24,
                  lineHeight: 1.1,
                  fontWeight: 600,
                  color: 'var(--color-primary)',
                  marginBottom: 8,
                  letterSpacing: '-0.03em',
                }}
              >
                {activeConfig.title}
              </h3>
              <p style={{ fontSize: 14, color: 'var(--color-secondary)', maxWidth: 560 }}>
                {activeConfig.description}
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            {activeConfig.cards.map((card) => (
              <section
                key={card.title}
                style={{
                  borderRadius: 20,
                  padding: 20,
                  background: 'linear-gradient(180deg, rgba(245,242,239,0.75) 0%, rgba(255,255,255,0.92) 100%)',
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: 'var(--shadow-warm)',
                }}
              >
                <div style={{ marginBottom: 14 }}>
                  <h4 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 4 }}>
                    {card.title}
                  </h4>
                  <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>{card.description}</p>
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  {card.items.map((item) => (
                    <label
                      key={item}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        borderRadius: 14,
                        background: 'rgba(255,255,255,0.88)',
                        boxShadow: 'var(--shadow-inset)',
                        color: 'var(--color-secondary)',
                        fontSize: 13,
                      }}
                    >
                      <input type="checkbox" defaultChecked style={{ accentColor: '#6f4e37' }} />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}

            <section
              style={{
                borderRadius: 18,
                padding: 18,
                background: 'rgba(250,248,245,0.96)',
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: 'var(--shadow-ring)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Gauge size={16} strokeWidth={1.9} color="var(--color-secondary)" />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                  Why this is in settings
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>
                These controls affect the whole application experience. Dedicated operational data should stay in the main sidebar views so the settings area remains lightweight.
              </p>
            </section>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
