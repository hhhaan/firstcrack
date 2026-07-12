import type { ReactNode } from 'react';

type ModalScrollBodyProps = {
    children: ReactNode;
    /** Extra classes on the overflow viewport (not the padded content). */
    className?: string;
    /**
     * Classes for the inner content node (padding lives here).
     * Do not put padding on the viewport — bottom padding collapses at scroll end.
     */
    contentClassName?: string;
};

/**
 * Scroll region where padding is on the content, not the overflow viewport.
 */
export function ModalScrollBody({ children, className = '', contentClassName = 'px-7 py-7' }: ModalScrollBodyProps) {
    return (
        <div className={`overflow-y-auto min-h-0 flex-1 ${className}`.trim()}>
            <div className={contentClassName}>{children}</div>
        </div>
    );
}
