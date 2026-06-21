interface SkeletonProps {
    className?: string;
    width?: string | number;
    height?: string | number;
    borderRadius?: string;
}

export const Skeleton = ({ className = '', width, height = 16, borderRadius = '6px' }: SkeletonProps) => (
    <div
        className={`animate-pulse bg-surface dark:bg-surface-elevated ${className}`}
        style={{ width, height, borderRadius }}
    />
);
