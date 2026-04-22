import { type CSSProperties, type ReactNode } from 'react';

interface ModalShellProps {
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
  overlayStyle?: CSSProperties;
  contentStyle?: CSSProperties;
}

export default function ModalShell({
  children,
  onClose,
  labelledBy,
  overlayStyle,
  contentStyle,
}: ModalShellProps) {
  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(23, 23, 23, 0.32)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
        ...overlayStyle,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={contentStyle}
      >
        {children}
      </div>
    </div>
  );
}
