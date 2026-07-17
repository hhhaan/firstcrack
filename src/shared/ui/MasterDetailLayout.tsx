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
    <div className="grid items-start gap-5" style={{ gridTemplateColumns: '350px 1fr' }}>
        {left}
        <div className="sticky top-6">
            {detail ??
                (placeholder && (
                    <div className="bg-main-bg rounded-lg py-15 px-8 flex items-center justify-center text-muted text-sm dark:border dark:border-[#585d61]">
                        {placeholder}
                    </div>
                ))}
        </div>
    </div>
);
