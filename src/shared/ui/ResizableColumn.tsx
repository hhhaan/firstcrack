import { cn } from '@shared/lib/cn';
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { PanelResizeHandle } from './PanelResizeHandle';

const boxWidth = (element: HTMLElement): number => {
    if (element.offsetWidth > 0) return element.offsetWidth;
    const styled = Number.parseFloat(element.style.width);
    return Number.isFinite(styled) ? styled : 0;
};

/** Room for one column after the chart floor and the other columns. */
export const columnRoomPx = (column: HTMLElement, floor: number, chartFloor: number): number => {
    const rowWidth = column.parentElement?.parentElement?.clientWidth ?? 0;
    if (rowWidth <= 0) return floor;
    let others = 0;
    const aside = column.parentElement;
    if (aside) {
        for (const child of aside.children) {
            if (child === column || !(child instanceof HTMLElement)) continue;
            others += boxWidth(child);
        }
    }
    return Math.max(floor, Math.round(rowWidth - chartFloor - others));
};

type PanelColumnGroupValue = {
    chartFloor: number;
    widths: Record<string, number>;
    setWidth: (id: string, width: number) => void;
};

const PanelColumnContext = createContext<PanelColumnGroupValue | null>(null);

/** Remembers each column width while a column is unmounted. */
export const PanelColumnGroup = ({ chartFloor, children }: { chartFloor: number; children: ReactNode }) => {
    const [widths, setWidths] = useState<Record<string, number>>({});
    const setWidth = useCallback((id: string, width: number) => {
        const next = Math.round(width);
        setWidths((current) => (current[id] === next ? current : { ...current, [id]: next }));
    }, []);
    const value = useMemo(() => ({ chartFloor, widths, setWidth }), [chartFloor, widths, setWidth]);
    return <PanelColumnContext.Provider value={value}>{children}</PanelColumnContext.Provider>;
};

export const ResizableColumn = ({
    columnId,
    floor,
    label,
    className,
    children,
    panelId,
    testId,
    ariaLabel,
    onBelowFloor,
}: {
    columnId: string;
    floor: number;
    label: string;
    className?: string;
    children: ReactNode;
    panelId?: string;
    testId?: string;
    ariaLabel?: string;
    /** Called when a drag or key would go under the floor. The last open width stays stored. */
    onBelowFloor?: () => void;
}) => {
    const group = useContext(PanelColumnContext);
    const reactId = useId();
    const id = panelId ?? reactId;
    const ref = useRef<HTMLElement>(null);
    const previewRef = useRef<number | null>(null);
    const remembered = group?.widths[columnId];
    const openWidth = remembered != null && remembered >= floor ? remembered : floor;
    const [max, setMax] = useState(openWidth);
    const width = Math.min(openWidth, max);

    const measure = useCallback(() => {
        const column = ref.current;
        if (!column || !group) return;
        const next = columnRoomPx(column, floor, group.chartFloor);
        setMax((current) => (current === next ? current : next));
    }, [floor, group]);

    useLayoutEffect(() => {
        measure();
    }, [measure]);

    useEffect(() => {
        const aside = ref.current?.parentElement;
        if (!aside || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => measure());
        observer.observe(aside);
        if (aside.parentElement) observer.observe(aside.parentElement);
        return () => observer.disconnect();
    }, [measure]);

    const frame = (handle: ReactNode) => (
        <section
            ref={ref}
            id={id}
            data-testid={testId}
            aria-label={ariaLabel}
            className={cn('static flex min-h-0 shrink-0 self-stretch', className)}
            data-width={group ? width : undefined}
            style={group ? { width } : undefined}
        >
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                {handle}
                {children}
            </div>
        </section>
    );

    if (!group) return frame(null);

    return frame(
        <PanelResizeHandle
            label={label}
            controls={id}
            width={width}
            min={onBelowFloor ? floor - 1 : floor}
            max={Math.max(width, max)}
            onWidthPreview={(next) => {
                const px = Math.round(next);
                if (px < floor) {
                    const keep = previewRef.current;
                    previewRef.current = null;
                    if (keep != null) group.setWidth(columnId, keep);
                    onBelowFloor?.();
                    return;
                }
                if (previewRef.current === px) return;
                previewRef.current = px;
                const column = ref.current;
                if (!column) return;
                column.style.width = `${px}px`;
                column.querySelector('[role="separator"]')?.setAttribute('aria-valuenow', String(px));
            }}
            onWidthChange={(next) => {
                const px = Math.round(next);
                previewRef.current = null;
                if (px < floor) {
                    onBelowFloor?.();
                    return;
                }
                group.setWidth(columnId, px);
            }}
        />,
    );
};
