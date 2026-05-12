import { type ReactNode } from 'react';

interface PageLayoutProps {
    children: ReactNode;
    maxWidth?: number;
}

export const PageLayout = ({ children, maxWidth = 1024 }: PageLayoutProps) => (
    // export const PageLayout = ({ children, maxWidth = 1280 }: PageLayoutProps) => (
    <div className="px-10 py-8 mx-auto" style={{ maxWidth }}>
        {children}
    </div>
);
