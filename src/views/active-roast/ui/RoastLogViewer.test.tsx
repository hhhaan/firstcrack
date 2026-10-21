// @vitest-environment jsdom
import type { LogEntry } from '@shared/types/roast';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoastLogViewer } from './RoastLogViewer';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps reference rows read-only while the current log continues receiving entries', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const remove = vi.fn();
    const reference = {
        name: 'Reference A',
        loading: false,
        error: false,
        entries: [{ id: 'ref', event: 'Heater', time: '1:40', timeSec: 100, temp: '140°C', note: '70%' }],
    };
    const Harness = ({ entries }: { entries: LogEntry[] }) => {
        const [showReference, onSourceChange] = useState(false);
        return (
            <RoastLogViewer
                variant="panel"
                entries={entries}
                onRemoveEntry={remove}
                reference={reference}
                showReference={showReference}
                onSourceChange={onSourceChange}
            />
        );
    };
    try {
        act(() => root.render(<Harness entries={[]} />));
        act(() => host.querySelectorAll('button')[1].click());
        expect(host.textContent).toContain('Reference A');
        expect(host.textContent).toContain('70%');
        expect(host.querySelector('[aria-label^="Delete"]')).toBeNull();
        act(() =>
            root.render(
                <Harness
                    entries={[{ id: 'live', event: 'Note', time: '2:00', temp: '155°C', note: 'new live record' }]}
                />,
            ),
        );
        expect(host.textContent).not.toContain('new live record');
        act(() => host.querySelectorAll('button')[0].click());
        expect(host.textContent).toContain('new live record');
        expect(remove).not.toHaveBeenCalled();
    } finally {
        act(() => root.unmount());
    }
});
