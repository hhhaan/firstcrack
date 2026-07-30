import { ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
    page: number;
    totalPages: number;
    onPageChange: (p: number) => void;
};

/**
 * Page button group for paginated tables. Deliberately excludes the "1–10 of 42" label —
 * that copy is domain-specific (sessions / orders), so each table keeps its own.
 */
export const TablePagination = ({ page, totalPages, onPageChange }: Props) => (
    <div className="flex items-center gap-1">
        <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="flex h-6 w-6 items-center justify-center rounded text-muted transition hover:bg-surface hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
        >
            <ChevronLeft size={13} strokeWidth={2} />
        </button>

        {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .reduce<(number | '…')[]>((acc, p, i, arr) => {
                if (i > 0 && p - arr[i - 1] > 1) acc.push('…');
                acc.push(p);
                return acc;
            }, [])
            .map((item, i) =>
                item === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted">
                        …
                    </span>
                ) : (
                    <button
                        type="button"
                        key={item}
                        onClick={() => onPageChange(item)}
                        className={`h-6 min-w-6 rounded px-1.5 text-xs font-medium transition ${
                            page === item
                                ? 'bg-surface-warm-solid text-primary'
                                : 'text-muted hover:bg-surface hover:text-secondary'
                        }`}
                    >
                        {item}
                    </button>
                ),
            )}

        <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages || totalPages === 0}
            className="flex h-6 w-6 items-center justify-center rounded text-muted transition hover:bg-surface hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
        >
            <ChevronRight size={13} strokeWidth={2} />
        </button>
    </div>
);
