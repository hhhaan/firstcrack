import { Skeleton } from '@shared/ui/Skeleton';
import { TableSkeleton } from '@shared/ui/TableSkeleton';

const orderCols = [
    { width: '14%', bar: '70%' },
    { width: '12%', bar: 56, height: 18, borderRadius: '9999px' },
    { width: '20%', bar: '65%' },
    { width: '10%', bar: '40%' },
    { width: '14%', bar: 64, height: 18, borderRadius: '9999px' },
    { width: '12%', bar: 72, height: 28, borderRadius: '9999px' },
];

export const OrdersTableSkeleton = () => <TableSkeleton cols={orderCols} rows={6} minWidth="560px" />;

export const ChannelsListSkeleton = () => (
    <div className="space-y-2.5" role="status" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
            <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-main-bg px-4 py-3.5 dark:border-border"
            >
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Skeleton width={140} height={14} borderRadius="4px" />
                        <Skeleton width={48} height={18} borderRadius="9999px" />
                        <Skeleton width={56} height={18} borderRadius="9999px" />
                    </div>
                    <Skeleton width={200} height={12} borderRadius="4px" />
                </div>
                <div className="flex gap-1.5">
                    <Skeleton width={72} height={28} borderRadius="9999px" />
                    <Skeleton width={88} height={28} borderRadius="9999px" />
                </div>
            </div>
        ))}
    </div>
);
