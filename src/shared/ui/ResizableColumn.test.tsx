// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { columnRoomPx, PanelColumnGroup, ResizableColumn } from './ResizableColumn';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const column = (columnId: string, floor: number, label: string, onBelowFloor?: () => void) =>
    createElement(ResizableColumn, { key: columnId, columnId, floor, label, onBelowFloor }, columnId);

const renderColumns = (children: ReactNode) => {
    const row = document.createElement('div');
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 1200 });
    document.body.appendChild(row);
    const root = createRoot(row);
    const draw = (nodes: ReactNode) => {
        act(() => {
            root.render(createElement(PanelColumnGroup, { chartFloor: 320 }, createElement('section', null, nodes)));
        });
    };
    draw(children);
    const divider = (name: string) => row.querySelector(`[aria-label="${name}"]`) as HTMLDivElement;
    for (const handle of row.querySelectorAll('[role="separator"]')) {
        (handle as HTMLDivElement).setPointerCapture = vi.fn();
    }
    return { row, root, draw, divider };
};

const pointer = (divider: HTMLDivElement, type: string, x: number) =>
    act(() => {
        divider.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1 }));
    });

it('keeps a column max inside the chart floor and the sibling widths', () => {
    const row = document.createElement('div');
    const aside = document.createElement('section');
    const machine = document.createElement('section');
    const readings = document.createElement('section');
    machine.style.width = '160px';
    readings.style.width = '200px';
    aside.append(machine, readings);
    row.append(aside);
    Object.defineProperty(row, 'clientWidth', { value: 1200 });
    expect(columnRoomPx(machine, 160, 320)).toBe(680);
    expect(columnRoomPx(machine, 160, 2000)).toBe(160);
});

it('resizes each column on its own and refuses to go under that column floor', () => {
    const view = renderColumns([
        column('machine', 160, 'Resize machine control'),
        column('readings', 176, 'Resize readings'),
    ]);
    try {
        const machine = view.divider('Resize machine control');
        const readings = view.divider('Resize readings');
        expect(machine.getAttribute('aria-valuenow')).toBe('160');
        expect(machine.getAttribute('aria-valuemin')).toBe('160');
        expect(machine.getAttribute('aria-valuemax')).toBe('704');
        expect(readings.getAttribute('aria-valuenow')).toBe('176');
        pointer(machine, 'pointerdown', 500);
        pointer(machine, 'pointermove', 460);
        expect(machine.getAttribute('aria-valuenow')).toBe('200');
        expect(readings.getAttribute('aria-valuenow')).toBe('176');
        pointer(readings, 'pointerdown', 500);
        pointer(readings, 'pointermove', 900);
        expect(readings.getAttribute('aria-valuenow')).toBe('176');
        expect(machine.getAttribute('aria-valuenow')).toBe('200');
    } finally {
        act(() => view.root.unmount());
        view.row.remove();
    }
});

it('collapses a column dragged under its floor and restores the last open width', () => {
    const collapse = vi.fn();
    const view = renderColumns([
        column('readings', 176, 'Resize readings'),
        column('log', 160, 'Resize roast log', collapse),
    ]);
    try {
        const log = view.divider('Resize roast log');
        expect(log.getAttribute('aria-valuemin')).toBe('159');
        pointer(log, 'pointerdown', 500);
        pointer(log, 'pointermove', 420);
        expect(log.getAttribute('aria-valuenow')).toBe('240');
        expect(collapse).not.toHaveBeenCalled();
        pointer(log, 'pointermove', 900);
        expect(collapse).toHaveBeenCalledOnce();
        expect(log.getAttribute('aria-valuenow')).toBe('240');
        view.draw(column('readings', 176, 'Resize readings'));
        view.draw([column('readings', 176, 'Resize readings'), column('log', 160, 'Resize roast log', collapse)]);
        expect(view.divider('Resize roast log').getAttribute('aria-valuenow')).toBe('240');
    } finally {
        act(() => view.root.unmount());
        view.row.remove();
    }
});

it('draws a plain column when it is outside a group', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        act(() =>
            root.render(
                createElement(ResizableColumn, { columnId: 'machine', floor: 160, label: 'Resize machine control' }),
            ),
        );
        expect(host.querySelector('[role="separator"]')).toBeNull();
        expect((host.firstElementChild as HTMLElement).style.width).toBe('');
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
