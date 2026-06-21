import { Skeleton } from '@shared/ui/Skeleton';

export const BatchCardSkeleton = () => (
    <div className="rounded-xl p-4 bg-main-bg dark:bg-[#262b31]">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
                <Skeleton width={14} height={14} borderRadius="4px" />
                <Skeleton width={120} height={14} borderRadius="4px" />
                <Skeleton width={40} height={16} borderRadius="9999px" />
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <Skeleton width={56} height={20} borderRadius="6px" />
                <Skeleton width={52} height={24} borderRadius="8px" />
                <Skeleton width={48} height={24} borderRadius="8px" />
                <Skeleton width={24} height={24} borderRadius="6px" />
                <Skeleton width={24} height={24} borderRadius="6px" />
            </div>
        </div>

        {/* Detail row */}
        <div className="mt-2.5 pl-[22px] space-y-2">
            <div className="flex items-center gap-2.5">
                <Skeleton width={80} height={12} borderRadius="4px" />
                <Skeleton width={10} height={12} borderRadius="4px" />
                <Skeleton width={80} height={12} borderRadius="4px" />
                <Skeleton width={10} height={12} borderRadius="4px" />
                <Skeleton width={60} height={12} borderRadius="4px" />
            </div>
            <Skeleton width={180} height={12} borderRadius="4px" />
        </div>

        {/* Reorder buttons */}
        <div className="mt-3 pl-[22px] flex items-center gap-1">
            <Skeleton width={24} height={24} borderRadius="6px" />
            <Skeleton width={24} height={24} borderRadius="6px" />
        </div>
    </div>
);
