import { useRoastSessionsInfinite } from '@entities/roast';
import { useRoastProfileCurve } from '@entities/roast-profile';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type HistoryReference, historyReferenceTitle, toHistoryReference } from '../model/reference';

export type { HistoryReference };

export const HistoryReferencePicker = ({
    ownerId,
    onSelect,
    onClose,
}: {
    ownerId: string;
    onSelect: (reference: HistoryReference) => void;
    onClose: () => void;
}) => {
    const { t } = useTranslation();
    const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useRoastSessionsInfinite(
        ownerId,
        'completed',
    );
    const sessions = data?.pages.flatMap((page) => page.data) ?? [];
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const sentinelRef = useCallback(
        (node: HTMLDivElement | null) => {
            observerRef.current?.disconnect();
            observerRef.current = null;
            if (!node || !hasNextPage || isFetchingNextPage) return;
            const observer = new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
            });
            observer.observe(node);
            observerRef.current = observer;
        },
        [fetchNextPage, hasNextPage, isFetchingNextPage],
    );
    const selected = sessions.find((session) => session.id === selectedId && session.user_id === ownerId);
    const curve = useRoastProfileCurve(selected?.tsv_path);
    const rows = sessions.filter((session) =>
        historyReferenceTitle(session).toLowerCase().includes(search.trim().toLowerCase()),
    );
    const apply = () => {
        const reference = selected ? toHistoryReference(selected, ownerId) : null;
        if (!reference || !curve.data?.length || curve.isError) return;
        onSelect(reference);
        onClose();
    };
    return (
        <ModalShell
            onClose={onClose}
            labelledBy="history-reference-title"
            data-testid="history-reference-picker"
            contentClassName="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-border bg-main-bg p-6"
        >
            <h2 id="history-reference-title" className="mb-4 text-lg text-primary">
                {t('activeRoast.reference.choose')}
            </h2>
            <input
                aria-label={t('history.searchPlaceholder')}
                placeholder={t('history.searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="mb-3 rounded border border-border bg-surface p-2 text-sm text-primary"
            />
            {isLoading && <p role="status">{t('common.loading')}</p>}
            {isError && <p role="alert">{t('activeRoast.reference.failed')}</p>}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {rows.map((session) => (
                    <button
                        type="button"
                        key={session.id}
                        disabled={!session.tsv_path}
                        aria-pressed={selectedId === session.id}
                        onClick={() => setSelectedId(session.id)}
                        className={`block w-full rounded border p-3 text-left text-sm text-primary disabled:opacity-40 ${selectedId === session.id ? 'border-primary' : 'border-border'}`}
                    >
                        {historyReferenceTitle(session)}
                        {!session.tsv_path && (
                            <span className="ml-2 text-xs text-muted">{t('activeRoast.reference.noCurve')}</span>
                        )}
                    </button>
                ))}
                {/* key가 바뀌면 센티널이 다시 붙는다. 아직 보이면 다음 10개를 받는다. */}
                {hasNextPage && <div key={data?.pages.length ?? 0} ref={sentinelRef} className="h-px" />}
                {isFetchingNextPage && <p role="status">{t('common.loading')}</p>}
                {!isLoading && !isFetchingNextPage && !isError && !rows.length && !hasNextPage && (
                    <p className="text-sm text-muted">{t('activeRoast.reference.empty')}</p>
                )}
            </div>
            {selected && curve.isLoading && <p role="status">{t('common.loading')}</p>}
            {selected && (curve.isError || (!curve.isLoading && !curve.data?.length)) && (
                <p role="alert">
                    {t(curve.isError ? 'activeRoast.reference.failed' : 'activeRoast.reference.noCurve')}
                </p>
            )}
            <div className="mt-4 flex justify-end gap-4">
                <button type="button" onClick={onClose} className="text-sm text-muted">
                    {t('common.cancel')}
                </button>
                <button
                    type="button"
                    disabled={!selected || curve.isLoading || curve.isError || !curve.data?.length}
                    onClick={apply}
                    className="text-sm text-primary disabled:opacity-40"
                >
                    {t('activeRoast.reference.apply')}
                </button>
            </div>
        </ModalShell>
    );
};
