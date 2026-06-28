export const WarmActionPanel = ({
    enabled,
    children,
    className = '',
}: {
    enabled: boolean;
    children: React.ReactNode;
    className?: string;
}) => (
    <div
        className={`p-6 rounded-[20px] transition-opacity duration-200 ${className}`}
        style={{
            background: 'var(--color-surface-warm-solid)',
            boxShadow: 'var(--shadow-warm)',
            opacity: enabled ? 1 : 0.5,
            pointerEvents: enabled ? 'auto' : 'none',
        }}
    >
        {children}
    </div>
);
