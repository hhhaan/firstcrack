import { expect, it, vi } from 'vitest';
import { subscribeSecondClock } from './second-clock';

it('shares one timer and retains a shared subscriber until its last screen leaves', () => {
    vi.useFakeTimers();
    const update = vi.fn();
    const first = subscribeSecondClock(update);
    const second = subscribeSecondClock(update);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(update).toHaveBeenCalledTimes(1);
    first();
    vi.advanceTimersByTime(1000);
    expect(update).toHaveBeenCalledTimes(2);
    second();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
});
