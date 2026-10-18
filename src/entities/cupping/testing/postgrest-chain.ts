import { vi } from 'vitest';

export type PostgrestResult = { data: unknown; error: unknown };

export function postgrestChain(result: PostgrestResult) {
    const q = Promise.resolve(result) as Promise<PostgrestResult> & Record<string, ReturnType<typeof vi.fn>>;
    for (const m of ['insert', 'update', 'select', 'eq', 'delete', 'is', 'gt', 'order']) {
        q[m] = vi.fn(() => q);
    }
    q.single = vi.fn(() => Promise.resolve(result));
    q.maybeSingle = vi.fn(() => Promise.resolve(result));
    return q;
}
