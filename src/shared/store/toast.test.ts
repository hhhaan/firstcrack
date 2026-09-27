import { afterEach, expect, it, vi } from 'vitest';
import { useToastStore } from './toast';

afterEach(() => {
    for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
    vi.useRealTimers();
});

it('waits for the remaining display time after a paused toast resumes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useToastStore.getState().show('동기화 대기', 'info');
    const [toast] = useToastStore.getState().toasts;
    expect(toast?.tone).toBe('info');
    if (!toast) throw new Error('Toast was not created');

    vi.advanceTimersByTime(2_000);
    useToastStore.getState().pause(toast.id);
    vi.advanceTimersByTime(10_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    useToastStore.getState().resume(toast.id);
    vi.advanceTimersByTime(3_999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
});
