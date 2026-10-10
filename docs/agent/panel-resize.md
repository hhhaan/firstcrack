# Reusable panel resizing

The active roast screen gives each non-chart column its own left-edge
divider (`ResizableColumn` inside `RoastAside`): Machine Control (floor
160px), the readings panel (floor 176px), and the expanded log (floor
160px). A divider resizes only the column on its right. Those floors are
the open minimum. Dragging or stepping the log below 160px collapses it
back to the inline log and keeps the last open width for the next expand.
A drag writes that width on the column element and stores it once when
the pointer is released, so the column contents do not rerender during
the drag. Widths last for the session. The chart keeps at least 320px when a column
grows and the row is wide enough. Collapsed Machine Control is a 28px rail
with no divider. Opening the log still adds its open width, 160px until
the user has widened it.

## Usage

`src/shared/ui/PanelResizeHandle.tsx` renders the divider and uses
`src/shared/ui/usePanelResize.ts` for pointer and keyboard interactions.
The panel must sit to the **right** of the divider: dragging left increases its width.

```tsx
import { PanelResizeHandle } from '@shared/ui/PanelResizeHandle';
import { useId, useState } from 'react';

const ExamplePanel = () => {
    const id = useId();
    const [width, setWidth] = useState(160);
    return (
        <section id={id} className="relative shrink-0" style={{ width }}>
            <PanelResizeHandle
                label="Resize panel"
                controls={id}
                width={width}
                min={160}
                max={360}
                onWidthChange={setWidth}
            />
            <div className="h-full overflow-y-auto">Panel content</div>
        </section>
    );
};
```

- Keep the outer panel `relative` and `shrink-0`. Put scrolling on an inner container so it does not clip the divider.
- `width`, `min`, and `max` are finite CSS pixel values; provide `min <= width <= max`.
- Pointer capture keeps dragging active outside the divider. Releasing/canceling the pointer ends the drag.
- Focus the divider and use Left/Right for 10px changes; Home/End select the limits. These keys are consumed while the divider has focus.
- `onWidthChange` receives clamped values. The owner controls the width and decides whether to persist it; use the existing debounced settings store when persistence is needed.
- Pass `onWidthPreview` to move the panel during a drag. `onWidthChange` then runs once on release. Without a preview callback, `onWidthChange` runs on each move. Keyboard changes always use `onWidthChange`.
- Unmount the handle when its panel is collapsed. Keep equipment/session models mounted independently of panel visibility.
- For custom divider markup, call `usePanelResize({ width, min, max, onWidthChange })` and spread the returned event handlers on the focusable divider. Preserve its separator role, accessible label, orientation, controlled panel ID, and current/min/max ARIA values.

## Verification

`pnpm test src/shared/ui/PanelResizeHandle.test.tsx src/shared/ui/ResizableColumn.test.tsx`
