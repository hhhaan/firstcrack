import {
    type CuppingEventSummary,
    cuppingApi,
    cuppingKeys,
    cuppingResultsUrl,
    useCuppingEvent,
} from '@entities/cupping';
import { logger } from '@shared/lib/logger';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, QrCode } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CuppingResultsShareProps = {
    eventId: string;
    userId: string;
    listEvent: CuppingEventSummary | null;
};

export const CuppingResultsShare = ({ eventId, userId, listEvent }: CuppingResultsShareProps) => {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const { data: detail } = useCuppingEvent(eventId);
    const [resultsToken, setResultsToken] = useState<string | null>(
        () => detail?.results_token ?? listEvent?.results_token ?? null,
    );
    const [ensuring, setEnsuring] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const token = detail?.results_token ?? listEvent?.results_token ?? null;
        if (token) setResultsToken(token);
    }, [detail?.results_token, listEvent?.results_token]);

    useEffect(() => {
        if (resultsToken) return;
        let cancelled = false;
        setEnsuring(true);
        void cuppingApi
            .ensureResultsToken(eventId)
            .then((ev) => {
                if (cancelled) return;
                setResultsToken(ev.results_token);
                qc.setQueryData(cuppingKeys.event(eventId), ev);
                qc.setQueryData(cuppingKeys.events(userId), (old: CuppingEventSummary[] | undefined) =>
                    (old ?? []).map((e) => (e.id === eventId ? { ...e, results_token: ev.results_token } : e)),
                );
            })
            .catch((err: unknown) => {
                logger.capture(err, { scope: 'cupping.ensureResultsToken', eventId });
                if (!cancelled) setError(t('cupping.resultsLinkError'));
            })
            .finally(() => {
                if (!cancelled) setEnsuring(false);
            });
        return () => {
            cancelled = true;
        };
    }, [eventId, resultsToken, qc, userId, t]);

    useEffect(() => {
        if (!copied) return;
        const id = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(id);
    }, [copied]);

    const url = useMemo(() => (resultsToken ? cuppingResultsUrl(resultsToken) : null), [resultsToken]);
    const qrSrc = url
        ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`
        : null;

    const copy = async () => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
        } catch (err) {
            logger.capture(err, { scope: 'cuppingShare.copyLink' });
            setError(t('cupping.resultsLinkError'));
        }
    };

    return (
        <>
            <div className="mb-5 rounded-xl border border-border-subtle bg-main-bg p-4 dark:border-border">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="mb-1 text-[13px] font-semibold tracking-[0.14px] text-primary">
                            {t('cupping.resultsShareTitle')}
                        </p>
                        <p className="text-[12px] leading-relaxed tracking-[0.14px] text-muted">
                            {t('cupping.resultsShareBody')}
                        </p>
                        {error ? <p className="mt-2 text-[12px] text-muted">{error}</p> : null}
                        {url ? (
                            <p className="mt-2 break-all font-mono text-[11px] text-secondary">{url}</p>
                        ) : (
                            <p className="mt-2 text-[12px] text-muted">
                                {ensuring ? t('cupping.resultsLinkPreparing') : t('cupping.sessionEndedHint')}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            disabled={!url}
                            onClick={() => void copy()}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-transparent px-3 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 dark:border-border dark:hover:bg-surface-elevated cursor-pointer"
                        >
                            {copied ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
                            {copied ? t('cupping.copied') : t('cupping.copyLink')}
                        </button>
                        <button
                            type="button"
                            disabled={!url}
                            onClick={() => setShowQr(true)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-transparent px-3 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 dark:border-border dark:hover:bg-surface-elevated cursor-pointer"
                        >
                            <QrCode size={14} strokeWidth={1.75} />
                            {t('cupping.resultsQr')}
                        </button>
                        {url ? (
                            <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-transparent px-3 py-2 text-[12px] font-medium text-primary no-underline transition-colors hover:bg-surface dark:border-border dark:hover:bg-surface-elevated"
                            >
                                <Link2 size={14} strokeWidth={1.75} />
                                {t('cupping.openLink')}
                            </a>
                        ) : null}
                    </div>
                </div>
            </div>

            {showQr && url ? (
                <ModalShell onClose={() => setShowQr(false)} labelledBy="cupping-results-qr-title">
                    <div className="w-full max-w-sm rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-border">
                        <h2 id="cupping-results-qr-title" className="mb-1 text-base font-semibold text-primary">
                            {t('cupping.resultsShareTitle')}
                        </h2>
                        <p className="mb-4 text-[12px] text-muted">{t('cupping.resultsQrHint')}</p>
                        {qrSrc ? (
                            <img
                                src={qrSrc}
                                alt="Results QR"
                                width={180}
                                height={180}
                                className="mx-auto mb-4 rounded-md bg-white p-2"
                            />
                        ) : null}
                        <div className="mb-3 break-all font-mono text-[11px] text-secondary">{url}</div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void copy()}
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-border cursor-pointer"
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? t('cupping.copied') : t('cupping.copyLink')}
                            </button>
                            <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-border"
                            >
                                <Link2 size={14} />
                                {t('cupping.openLink')}
                            </a>
                        </div>
                    </div>
                </ModalShell>
            ) : null}
        </>
    );
};
