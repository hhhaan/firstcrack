import type { ReactNode } from 'react';

export const MasterDetailLayout = ({
    left,
    detail,
    placeholder,
}: {
    left: ReactNode;
    detail?: ReactNode | null;
    placeholder?: ReactNode;
}) => (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,350px)_minmax(0,1fr)]">
        <div className="min-w-0">{left}</div>
        <div className="min-w-0 lg:sticky lg:top-6">
            {detail ??
                (placeholder && (
                    <div className="flex items-center justify-center rounded-2xl border border-border bg-main-bg px-8 py-15 text-sm text-muted">
                        {placeholder}
                    </div>
                ))}
        </div>
    </div>
);
