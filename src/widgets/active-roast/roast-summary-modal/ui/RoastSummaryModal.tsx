import ModalShell from '../../../../shared/ui/modal-shell/ModalShell';

export interface RoastLogEntry {
  time: string;
  event: string;
  temp: string;
  note: string;
}

export interface RoastSummaryData {
  totalTime: string;
  development: string;
  finalBt: string;
  logEntries: RoastLogEntry[];
}

interface RoastSummaryModalProps {
  open: boolean;
  summaryData: RoastSummaryData | null;
  roastNotes: string;
  eventMarkerColor: Record<string, string>;
  onRoastNotesChange: (notes: string) => void;
  onClose: () => void;
}

export default function RoastSummaryModal({
  open,
  summaryData,
  roastNotes,
  eventMarkerColor,
  onRoastNotesChange,
  onClose,
}: RoastSummaryModalProps) {
  if (!open || !summaryData) {
    return null;
  }

  return (
    <ModalShell
      onClose={onClose}
      labelledBy="roast-summary-modal-title"
      overlayStyle={{
        zIndex: 10000,
        background: 'rgba(0,0,0,0.3)',
        backdropFilter: 'blur(4px)',
      }}
      contentStyle={{
        background: 'var(--bg)',
        borderRadius: 20,
        padding: '32px 36px',
        width: 480,
        boxShadow: 'rgba(0,0,0,0.2) 0px 20px 60px, rgba(0,0,0,0.06) 0px 0px 0px 1px',
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
          Roast Complete
        </div>
        <div
          id="roast-summary-modal-title"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 24, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}
        >
          Ethiopia Yirgacheffe
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Natural · Guji Zone · Profile: Signature Light</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Time', value: summaryData.totalTime },
          { label: 'Development', value: summaryData.development },
          { label: 'Final BT', value: summaryData.finalBt },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: '12px 14px', boxShadow: 'var(--shadow-inset)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 10 }}>Log</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 0' }}>
          {summaryData.logEntries.filter((entry) => eventMarkerColor[entry.event] || entry.event === 'Charge' || entry.event === 'Turning Point').map((entry, index, entries) => (
            <div key={`${entry.time}-${entry.event}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{entry.time}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: eventMarkerColor[entry.event] ?? 'var(--text-secondary)' }}>{entry.event}</span>
              {index < entries.length - 1 && <span style={{ margin: '0 6px', color: 'var(--border)', fontSize: 14 }}>·</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>Notes</div>
        <textarea
          value={roastNotes}
          onChange={(event) => onRoastNotesChange(event.target.value)}
          placeholder="Flavor notes, observations, adjustments for next time..."
          rows={3}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontFamily: 'var(--font-body)',
            resize: 'none',
            boxShadow: 'var(--shadow-inset)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%',
          padding: '13px 0',
          borderRadius: 9999,
          border: 'none',
          background: 'var(--text-primary)',
          color: 'white',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          letterSpacing: '0.14px',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        Save & Close
      </button>
    </ModalShell>
  );
}
