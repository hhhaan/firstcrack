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
    <div className="grid min-w-0 items-start gap-5" style={{ gridTemplateColumns: 'minmax(0, 350px) minmax(0, 1fr)' }}>
        <div className="min-w-0">{left}</div>
        <div className="min-w-0 sticky top-6">
            {detail ??
                (placeholder && (
                    <div className="bg-main-bg rounded-lg py-15 px-8 flex items-center justify-center text-muted text-sm dark:border dark:border-[#585d61]">
                        {placeholder}
                    </div>
                ))}
        </div>
    </div>
);
