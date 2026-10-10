import { PanelColumnGroup } from '@shared/ui/ResizableColumn';
import type { ReactNode } from 'react';

/** Leave the temperature chart at least this wide when a column grows. */
const ASIDE_CHART_FLOOR_PX = 320;

/**
 * Non-chart stack. Each column's left edge sets that column's width.
 * Widths live here so a collapsed log can open again at its last open width.
 */
export const RoastAside = ({ children }: { children: ReactNode }) => (
    <PanelColumnGroup chartFloor={ASIDE_CHART_FLOOR_PX}>
        <section data-testid="roast-aside" className="flex min-h-0 shrink-0 self-stretch">
            {children}
        </section>
    </PanelColumnGroup>
);
