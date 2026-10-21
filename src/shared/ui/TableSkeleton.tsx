import { Skeleton } from '@shared/ui/Skeleton';

export type TableSkeletonCol = {
    /** Column width (th/td style) */
    width: string;
    /** Skeleton bar width — default 70% */
    bar?: string | number;
    height?: number;
    borderRadius?: string;
};

type Props = {
    cols: TableSkeletonCol[];
    rows?: number;
    className?: string;
    minWidth?: string;
};

/** Generic table loading shell — matches History/Orders/Cupping list tables. */
export const TableSkeleton = ({ cols, rows = 6, className = '', minWidth }: Props) => (
    <div
        className={`overflow-x-auto rounded-2xl border border-border bg-main-bg dark:border-border ${className}`}
        role="status"
        aria-busy="true"
    >
        <table className="w-full border-collapse text-left" style={minWidth ? { minWidth } : undefined}>
            <thead>
                <tr className="border-b border-divider dark:border-border">
                    {cols.map((col, i) => (
                        <th key={i} className="h-12 px-4 py-0" style={{ width: col.width }}>
                            <Skeleton width={col.bar ?? '50%'} height={10} borderRadius="4px" />
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {Array.from({ length: rows }, (_, rowIdx) => (
                    <tr key={rowIdx} className="border-b border-divider last:border-0 dark:border-border">
                        {cols.map((col, colIdx) => (
                            <td key={colIdx} className="px-4 py-3.5" style={{ width: col.width }}>
                                <Skeleton
                                    width={col.bar ?? '70%'}
                                    height={col.height ?? 14}
                                    borderRadius={col.borderRadius ?? '4px'}
                                />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
