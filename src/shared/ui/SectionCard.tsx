import { cn } from '@shared/lib/cn';
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
        <section className={cn('flex min-w-0 flex-col rounded-2xl border border-border bg-main-bg p-4', className)}>
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
                <span className="mt-0.5 text-muted shrink-0 [&>svg]:block">{icon}</span>
            )}
            <div className="min-w-0 flex-1">
                <h4 className="m-0 text-base font-[450] leading-6 text-primary">{title}</h4>
                {description !== undefined && description !== null && (
                    <p className="text-[13px] text-muted m-0 mt-1 leading-relaxed">{description}</p>
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
