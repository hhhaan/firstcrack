import { Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppVersion } from '../model/useAppVersion';
import { useMachineStatus } from '../model/useMachineStatus';

interface BottomToolbarProps {
    children?: ReactNode;
}

export const BottomToolbar = ({ children }: BottomToolbarProps) => {
    const { connected, displayName, reconnecting } = useMachineStatus();
    const version = useAppVersion();

    return (
        <footer className="h-7 shrink-0 flex items-center justify-between gap-4 px-4 border-t border-border bg-surface text-[12px] tracking-[0.14px] text-secondary z-40">
            <div className="flex items-center gap-2 min-w-0">
                <Circle
                    size={6}
                    strokeWidth={0}
                    className={connected ? 'fill-palette-green' : 'fill-palette-gray'}
                    aria-hidden="true"
                />
                <span className="truncate">
                    {connected ? displayName || 'machine connected' : 'machine disconnected'}
                    {connected && reconnecting && ' · reconnecting'}
                </span>
            </div>

            {children && <div className="flex-1 flex justify-center min-w-0 truncate">{children}</div>}

            <span className="shrink-0">v{version}</span>
        </footer>
    );
};
