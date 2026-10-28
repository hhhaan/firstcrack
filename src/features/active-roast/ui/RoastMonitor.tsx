import { cn } from '@shared/lib/cn';
import { logger } from '@shared/lib/logger';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitorSnapshot } from '../lib/roast-monitor';
import { useRoastMonitor } from '../model/useRoastMonitor';

export function RoastMonitor() {
    const monitor = useRoastMonitor();
    useEffect(() => {
        if (!isTauri()) return;
        void getCurrentWindow()
            .setTitle('First Crack')
            .catch((error) => logger.capture(error, { feature: 'roast-monitor' }));
    }, []);
    return <RoastMonitorView {...monitor} onDrop={monitor.drop} onShowMain={monitor.showMain} />;
}

export function RoastMonitorView({
    snapshot,
    fresh,
    pending,
    failed,
    onDrop,
    onShowMain,
}: {
    snapshot: MonitorSnapshot | null;
    fresh: boolean;
    pending: boolean;
    failed: boolean;
    onDrop: () => void;
    onShowMain: () => void;
}) {
    const { t } = useTranslation();
    const live = fresh && snapshot?.connected && !snapshot.stale;
    const bbpActive = snapshot?.bbpTime != null;
    const dropped = fresh && !bbpActive && snapshot?.dropTime != null;
    const canDrop = !bbpActive && live && snapshot.canDrop && !pending;
    const showDevelopment =
        fresh &&
        !bbpActive &&
        snapshot != null &&
        ((snapshot.development !== '' && snapshot.development !== '—') || snapshot.dtr !== '');

    return (
        <main
            className="flex h-full flex-col overflow-y-auto bg-roast-bg p-3 text-primary"
            aria-label={t('activeRoast.monitor.title')}
        >
            {!live && (
                <p className="mb-2 truncate text-[11px] leading-4 text-muted" role="status">
                    {t(!fresh ? 'activeRoast.monitor.waiting' : 'activeRoast.monitor.disconnected')}
                </p>
            )}

            <dl className="space-y-1">
                <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-xs font-medium text-muted">BT</dt>
                    <dd
                        data-testid="monitor-bt"
                        className={cn(
                            'whitespace-nowrap font-inconsolata text-[34px] font-medium leading-none tracking-[-0.03em]',
                            live ? 'text-(--color-sensor-bt)' : 'text-muted',
                        )}
                    >
                        {live ? snapshot.bt : '—'}
                    </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-xs font-medium text-muted">ET</dt>
                    <dd
                        data-testid="monitor-et"
                        className={cn(
                            'whitespace-nowrap font-inconsolata text-[34px] font-medium leading-none tracking-[-0.03em]',
                            live ? 'text-(--color-sensor-et)' : 'text-muted',
                        )}
                    >
                        {live ? snapshot.et : '—'}
                    </dd>
                </div>
            </dl>

            <dl className="mt-2 grid grid-cols-2 gap-3 border-t border-border-subtle pt-2">
                <div>
                    <dt className="text-[11px] font-medium text-muted">
                        {bbpActive ? 'BBP' : t('activeRoast.monitor.elapsed')}
                    </dt>
                    <dd data-testid="monitor-time" className="mt-1 font-inconsolata text-[26px] leading-none">
                        {fresh ? (snapshot?.bbpTime ?? snapshot?.time) : '—'}
                    </dd>
                </div>
                <div className="text-right">
                    <dt className="text-[11px] font-medium text-muted">
                        RoR <span className="text-[10px]">{fresh ? snapshot?.rorUnit : ''}</span>
                    </dt>
                    <dd
                        data-testid="monitor-ror"
                        className="mt-1 whitespace-nowrap font-inconsolata text-[26px] leading-none"
                    >
                        {live ? snapshot.ror : '—'}
                    </dd>
                </div>
            </dl>

            {showDevelopment && (
                <dl className="mt-2 flex items-baseline justify-between gap-2 text-[11px]">
                    <dt className="text-muted">{t('activeRoast.monitor.development')}</dt>
                    <dd className="font-inconsolata text-sm leading-4">
                        {snapshot.development}
                        {snapshot.dtr ? ` · ${snapshot.dtr}` : ''}
                    </dd>
                </dl>
            )}

            {failed && (
                <p className="mt-3 text-xs text-secondary" role="alert">
                    {t('activeRoast.monitor.failed')}
                </p>
            )}

            <div className="mt-auto flex items-center justify-end gap-2 pt-1">
                {!bbpActive && (
                    <button
                        type="button"
                        data-testid="monitor-drop"
                        disabled={!canDrop}
                        onClick={onDrop}
                        className={cn(
                            'flex min-h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border disabled:cursor-default',
                            dropped
                                ? 'bg-(--color-phase-ready-bg) text-primary'
                                : 'bg-action text-on-action enabled:hover:opacity-85 disabled:bg-surface disabled:text-muted',
                        )}
                    >
                        {t(`activeRoast.monitor.${dropped ? 'dropRecorded' : pending ? 'recording' : 'markDrop'}`)}
                        {dropped && <span className="font-inconsolata font-medium">{snapshot.dropTime}</span>}
                    </button>
                )}
                <button
                    type="button"
                    onClick={onShowMain}
                    className="min-h-8 shrink-0 cursor-pointer text-xs text-secondary underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border"
                >
                    {t('activeRoast.monitor.showMain')}
                </button>
            </div>
        </main>
    );
}
