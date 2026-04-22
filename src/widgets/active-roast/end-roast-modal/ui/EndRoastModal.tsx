import { Square } from 'lucide-react';
import ModalShell from '../../../../shared/ui/modal-shell/ModalShell';

interface EndRoastModalProps {
  open: boolean;
  timeStr: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function EndRoastModal({ open, timeStr, onClose, onConfirm }: EndRoastModalProps) {
  if (!open) {
    return null;
  }

  return (
    <ModalShell
      onClose={onClose}
      labelledBy="end-roast-modal-title"
      overlayStyle={{
        zIndex: 10000,
        background: 'rgba(0,0,0,0.32)',
        backdropFilter: 'blur(6px)',
      }}
      contentStyle={{
        width: 'min(420px, 100%)',
        background: 'var(--color-main-bg)',
        borderRadius: 20,
        padding: '28px',
        boxShadow: 'rgba(0,0,0,0.22) 0px 24px 64px, rgba(0,0,0,0.06) 0px 0px 0px 1px',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: 'rgba(254,226,226,0.9)',
          color: '#dc2626',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <Square size={18} strokeWidth={2} />
      </div>
      <h2
        id="end-roast-modal-title"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 400,
          lineHeight: 1.05,
          color: 'var(--color-primary)',
          letterSpacing: '-0.5px',
          marginBottom: 10,
        }}
      >
        End this roast?
      </h2>
      <p style={{ fontSize: 14, color: 'var(--color-secondary)', lineHeight: 1.6, marginBottom: 22 }}>
        The roast timer will stop at {timeStr}, the roast log will be finalized, and the roast summary will open next.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button
          onClick={onClose}
          style={{
            padding: '12px 0',
            borderRadius: 9999,
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
          onClick={onConfirm}
          style={{
            padding: '12px 0',
            borderRadius: 9999,
            border: 'none',
            background: '#dc2626',
            color: 'white',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          End Roast
        </button>
      </div>
    </ModalShell>
  );
}
