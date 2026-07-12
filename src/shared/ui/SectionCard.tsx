import type { ReactNode } from 'react';

type SectionCardProps = {
    children: ReactNode;
    className?: string;
};

/**
 * Settings / form section shell.
 * Layout: padding + vertical stack (header → body). Spacing is owned here —
 * callers should not add mb-* between header and content.
 */
export function SectionCard({ children, className = '' }: SectionCardProps) {
    return (
        <section
            className={`flex flex-col gap-5 bg-white dark:bg-[#181d21] border border-[#E5E7EB] dark:border-[#585d61] rounded-xl p-6 ${className}`}
        >
            {children}
        </section>
    );
}

type SectionCardHeaderProps = {
    title: ReactNode;
    description?: ReactNode;
    /** Optional leading icon (e.g. Lucide node). */
    icon?: ReactNode;
};

function SectionCardHeader({ title, description, icon }: SectionCardHeaderProps) {
    return (
        <header className="flex items-start gap-2.5 shrink-0 min-w-0">
            {icon !== undefined && icon !== null && (
                <span className="mt-0.5 text-[#6B7280] dark:text-[#999] shrink-0 [&>svg]:block">{icon}</span>
            )}
            <div className="min-w-0 flex-1">
                <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0 leading-snug">
                    {title}
                </h4>
                {description !== undefined && description !== null && (
                    <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0 mt-1 leading-relaxed">
                        {description}
                    </p>
                )}
            </div>
        </header>
    );
}

type SectionCardBodyProps = {
    children: ReactNode;
    className?: string;
};

/** Content region under the header. Put rows / controls here. */
function SectionCardBody({ children, className = '' }: SectionCardBodyProps) {
    return <div className={`min-w-0 ${className}`}>{children}</div>;
}

SectionCard.Header = SectionCardHeader;
SectionCard.Body = SectionCardBody;
