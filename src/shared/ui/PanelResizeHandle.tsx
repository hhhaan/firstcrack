import { type PanelResizeOptions, usePanelResize } from './usePanelResize';

export const PanelResizeHandle = ({
    label,
    controls,
    ...options
}: PanelResizeOptions & { label: string; controls: string }) => {
    const handlers = usePanelResize(options);
    return (
        <div
            role="separator"
            tabIndex={0}
            aria-label={label}
            aria-orientation="vertical"
            aria-controls={controls}
            aria-valuemin={options.min}
            aria-valuemax={options.max}
            aria-valuenow={options.width}
            {...handlers}
            className="absolute -left-1 top-0 bottom-0 z-10 w-2 cursor-col-resize touch-none hover:bg-border-subtle focus-visible:bg-border-subtle focus-visible:outline-none"
        />
    );
};
