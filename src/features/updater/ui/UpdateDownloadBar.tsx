type UpdateDownloadBarProps = {
    progress: number;
    label: string;
};

export function UpdateDownloadBar({ progress, label }: UpdateDownloadBarProps) {
    const indeterminate = progress <= 0;
    const sliding = indeterminate
        ? 'w-2/5 animate-[door-probe_0.9s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-pulse'
        : '';

    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : progress}
            className="h-1.5 w-full overflow-hidden rounded-full bg-white/30"
        >
            <div
                className={`h-full rounded-full bg-white ${sliding}`}
                style={indeterminate ? undefined : { width: `${progress}%` }}
            />
        </div>
    );
}
