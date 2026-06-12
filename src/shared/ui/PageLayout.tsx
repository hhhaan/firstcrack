import { type ReactNode } from 'react';

interface PageLayoutProps {
    children: ReactNode;
    maxWidth?: number;
}

export const PageLayout = ({ children, maxWidth = 1280 }: PageLayoutProps) => (
    // w-full is required: without it, mx-auto in a flex-column parent overrides
    // align-items:stretch, causing the layout to shrink to content width.
    // Do NOT remove w-full.
    <div className="px-10 py-8 w-full mx-auto" style={{ maxWidth }}>
        {children}
    </div>
);
