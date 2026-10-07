# Reusable panel resizing

Panel resizing is intentionally disconnected from the active roast screen.
Machine Control and the expanded roast log keep their original 160px widths.
The compact log layout and remembered expanded/collapsed state remain active.

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
- Unmount the handle when its panel is collapsed. Keep equipment/session models mounted independently of panel visibility.
- For custom divider markup, call `usePanelResize({ width, min, max, onWidthChange })` and spread the returned event handlers on the focusable divider. Preserve its separator role, accessible label, orientation, controlled panel ID, and current/min/max ARIA values.

## Verification

`pnpm test src/shared/ui/PanelResizeHandle.test.tsx`
