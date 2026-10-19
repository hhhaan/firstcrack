import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ControlCommand, type ControlSendObserver, createControlSender, settledRoles } from './controlSender';

/** 수동으로 resolve하는 send — in-flight 구간을 정확히 제어하기 위해 */
const deferredSend = () => {
    const calls: ControlCommand[] = [];
    let resolveCurrent: ((applied: ControlCommand) => void) | null = null;
    let rejectCurrent: ((err: unknown) => void) | null = null;
    const send = (cmd: ControlCommand) => {
        calls.push(cmd);
        return new Promise<ControlCommand>((resolve, reject) => {
            resolveCurrent = resolve;
            rejectCurrent = reject;
        });
    };
    return {
        calls,
        send,
        resolve: (applied?: ControlCommand) => resolveCurrent?.(applied ?? calls[calls.length - 1]),
        reject: (err: unknown) => rejectCurrent?.(err),
    };
};

/** Promise가 이미 settle됐는지 한 틱을 기다린 뒤 확인한다 */
const peek = async <T>(p: Promise<T>) => {
    const state: { done: boolean; value?: T } = { done: false };
    void p.then((value) => {
        state.done = true;
        state.value = value;
    });
    await Promise.resolve();
    return state;
};

describe('settledRoles', () => {
    const fb = { heater: 60, fan: 100, drum: 50 };

    it('기기가 지시값에 도달하면 그 role을 반환한다', () => {
        expect(settledRoles({ heater: 60 }, fb, 1)).toEqual(['heater']);
    });

    it('허용 오차 안이면 도달로 본다', () => {
        expect(settledRoles({ heater: 59 }, fb, 1)).toEqual(['heater']);
        expect(settledRoles({ heater: 58 }, fb, 1)).toEqual([]);
    });

    it('아직 안 따라온 role은 남긴다', () => {
        expect(settledRoles({ heater: 47 }, fb, 1)).toEqual([]);
    });

    it('지시가 없는 role은 대상이 아니다', () => {
        expect(settledRoles({}, fb, 1)).toEqual([]);
    });

    it('피드백을 읽을 수 없는 채널(null)은 절대 도달로 보지 않는다', () => {
        // 화력 피드백 채널이 없는 머신 — 수렴 판정이 안 되므로 미반영 경로가 드러나야 한다
        expect(settledRoles({ heater: 60 }, { heater: null, fan: 100, drum: 50 }, 1)).toEqual([]);
        expect(settledRoles({ heater: 60, fan: 100 }, { heater: null, fan: 100, drum: 50 }, 1)).toEqual(['fan']);
    });

    it('여러 role을 동시에 판정한다', () => {
        expect(settledRoles({ heater: 60, fan: 100, drum: 20 }, fb, 1)).toEqual(['heater', 'fan']);
    });

    it('0 지시도 대상이다 (falsy 값 취급 주의)', () => {
        expect(settledRoles({ heater: 0 }, { ...fb, heater: 0 }, 1)).toEqual(['heater']);
    });
});

describe('createControlSender', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('observes only dispatched commands with the origin of each merged role', async () => {
        const d = deferredSend();
        const observer = { dispatched: vi.fn(), applied: vi.fn(), failed: vi.fn() } satisfies ControlSendObserver;
        const sender = createControlSender({ send: d.send, observer });
        sender.queue('heater', 50);
        const first = sender.commitNow('manual');
        sender.queue('heater', 0);
        const second = sender.commitNow('replay');
        sender.queue('fan', 70);
        const third = sender.commitNow('manual');
        expect(observer.dispatched).toHaveBeenCalledExactlyOnceWith({ heater: 50 }, { heater: 'manual' });
        d.resolve();
        await first;
        expect(observer.dispatched).toHaveBeenLastCalledWith(
            { heater: 0, fan: 70 },
            { heater: 'replay', fan: 'manual' },
        );
        expect(observer.applied).toHaveBeenCalledWith({ heater: 50 }, { heater: 50 });
        d.resolve();
        await Promise.all([second, third]);
        expect(observer.applied).toHaveBeenLastCalledWith({ heater: 0, fan: 70 }, { heater: 0, fan: 70 });
    });

    it('never observes cancelled queued commands or acknowledges an obsolete generation', async () => {
        const d = deferredSend();
        const observer = { dispatched: vi.fn(), applied: vi.fn(), failed: vi.fn() } satisfies ControlSendObserver;
        const sender = createControlSender({ send: d.send, observer });
        sender.queue('heater', 50);
        const first = sender.commitNow();
        sender.queue('heater', 0);
        const queued = sender.commitNow('replay');
        sender.cancelUnsent({ origin: 'replay', role: 'heater' });
        sender.dispose();
        d.resolve();
        await Promise.all([first, queued]);
        expect(observer.dispatched).toHaveBeenCalledTimes(1);
        expect(observer.applied).not.toHaveBeenCalled();
    });

    it('isolates diagnostic observer failures from the command and its acknowledgement', async () => {
        const fail = () => {
            throw new Error('observer failure');
        };
        const sender = createControlSender({
            send: async (cmd) => cmd,
            observer: { dispatched: fail, applied: fail, failed: fail },
        });
        sender.queue('heater', 0);
        await expect(sender.commitNow('replay')).resolves.toEqual({ heater: 0 });
    });

    it('드래그 중간값은 기기로 나가지 않는다 — 손을 뗄 때 마지막 값 하나만', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send });

        sender.queue('heater', 10);
        sender.queue('heater', 20);
        sender.queue('heater', 30);
        // 시간이 아무리 지나도 저절로 나가지 않는다
        await vi.advanceTimersByTimeAsync(5000);
        expect(send).not.toHaveBeenCalled();

        await sender.commitNow();
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ heater: 30 });
    });

    it('여러 role 변경을 하나의 명령으로 합친다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send });

        sender.queue('heater', 60);
        sender.queue('fan', 40);
        await sender.commitNow();

        expect(send).toHaveBeenCalledWith({ heater: 60, fan: 40 });
    });

    it('보낼 값이 없으면 전송하지 않는다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send });

        await sender.commitNow();
        expect(send).not.toHaveBeenCalled();
    });

    it('비어 있지 않은 commit snapshot을 전송 전 한 번 알린다', async () => {
        const order: string[] = [];
        const onCommitted = vi.fn((cmd: ControlCommand) => order.push(`commit:${cmd.heater}`));
        const send = vi.fn(async (cmd: ControlCommand) => {
            order.push(`send:${cmd.heater}`);
            return cmd;
        });
        const sender = createControlSender({ send, onCommitted });

        sender.queue('heater', 0);
        await sender.commitNow();
        await sender.commitNow();

        expect(onCommitted).toHaveBeenCalledTimes(1);
        expect(onCommitted).toHaveBeenCalledWith({ heater: 0 });
        expect(order).toEqual(['commit:0', 'send:0']);
    });

    it('이미 보낸 in-flight 같은 role은 대기 대체와 무관하게 자신의 applied를 받는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('heater', 10);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 80);
        const pB = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        d.resolve({ heater: 10 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toEqual({ heater: 10 });
        expect((await peek(pB)).done).toBe(false);
        expect(d.calls).toEqual([{ heater: 10 }, { heater: 80 }]);

        d.resolve({ heater: 80 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pB).resolves.toEqual({ heater: 80 });
    });

    it('전송 중에는 새 요청을 겹쳐 보내지 않고, 끝난 뒤 최신값만 보낸다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('heater', 10);
        void sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ heater: 10 }]);

        // 첫 요청이 아직 응답 전 — 사용자가 슬라이더를 더 움직였다
        sender.queue('heater', 55);
        void sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 80);
        void sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toHaveLength(1); // 아직 겹쳐 보내지 않았다

        d.resolve();
        await vi.advanceTimersByTimeAsync(0);

        // 중간값 55는 건너뛰고 마지막 지시값만 전송 — 도착 순서 역전 방지
        expect(d.calls).toEqual([{ heater: 10 }, { heater: 80 }]);
    });

    it('in-flight 응답이 와도 커밋 안 된 드래그 중간값은 전송하지 않는다 (#269)', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('heater', 10);
        void sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ heater: 10 }]);

        // 응답 대기 중 사용자가 드래그만 하고 아직 손을 떼지 않았다
        sender.queue('heater', 40);
        d.resolve();
        await vi.advanceTimersByTimeAsync(5000);
        expect(d.calls).toHaveLength(1); // 커밋 전에는 나가지 않는다

        // 손을 떼면 그때 나간다
        void sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ heater: 10 }, { heater: 40 }]);
    });

    it('사이드카가 자른 값을 onApplied로 돌려준다', async () => {
        const onApplied = vi.fn();
        const sender = createControlSender({ send: async () => ({ heater: 100 }), onApplied });

        sender.queue('heater', 150);
        await sender.commitNow();

        expect(onApplied).toHaveBeenCalledWith({ heater: 100 });
    });

    it('commitNow는 성공 시 applied, 실패 시 null을 돌려준다', async () => {
        const send = vi.fn(async () => ({ heater: 1 }));
        const sender = createControlSender({ send });
        sender.queue('heater', 0);
        await expect(sender.commitNow()).resolves.toEqual({ heater: 1 });

        send.mockRejectedValueOnce(new Error('409'));
        sender.queue('heater', 0);
        await expect(sender.commitNow()).resolves.toBeNull();
    });

    it('전송 실패를 onError로 알리고 이후 전송을 막지 않는다', async () => {
        const onError = vi.fn();
        let shouldFail = true;
        const send = vi.fn(async (cmd: ControlCommand) => {
            if (shouldFail) throw new Error('409');
            return cmd;
        });
        const sender = createControlSender({ send, onError });

        sender.queue('heater', 50);
        await sender.commitNow();
        expect(onError).toHaveBeenCalledTimes(1);

        shouldFail = false;
        sender.queue('heater', 60);
        await sender.commitNow();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('dispose 후 도착한 응답의 콜백은 무시된다', async () => {
        const d = deferredSend();
        const onApplied = vi.fn();
        const onError = vi.fn();
        const onSendingChange = vi.fn();
        const sender = createControlSender({ send: d.send, onApplied, onError, onSendingChange });

        sender.queue('heater', 50);
        void sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toHaveLength(1);

        // 연결이 끊겨 상태를 비운 뒤 늦게 응답이 도착하는 상황
        sender.dispose();
        onSendingChange.mockClear();
        d.resolve({ heater: 50 });
        await vi.advanceTimersByTimeAsync(0);

        expect(onApplied).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(onSendingChange).not.toHaveBeenCalled();
    });

    it('dispose는 아직 안 보낸 값을 버린다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send });

        sender.queue('heater', 50);
        sender.dispose();
        await sender.commitNow();

        expect(send).not.toHaveBeenCalled();
    });

    it('in-flight 중 다른 role commit은 요청값을 성공으로 돌려주지 않고 실제 전송을 기다린다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('fan', 80);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        sender.queue('heater', 50);
        const pB = sender.commitNow();
        const b = await peek(pB);
        await vi.advanceTimersByTimeAsync(0);

        expect(d.calls).toEqual([{ fan: 80 }]);
        expect(b.done).toBe(false);

        d.resolve({ fan: 80 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toEqual({ fan: 80 });
        expect(b.done).toBe(false);
        expect(d.calls).toEqual([{ fan: 80 }, { heater: 50 }]);

        d.reject(new Error('heater failed'));
        await vi.advanceTimersByTimeAsync(0);
        await expect(pB).resolves.toBeNull();
    });

    it('A 실패 후 B 성공은 각 요청에 따로 귀속되고 A는 B를 기다리지 않는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('fan', 80);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        sender.queue('heater', 50);
        const pB = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        d.reject(new Error('fan failed'));
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toBeNull();
        expect((await peek(pB)).done).toBe(false);
        expect(d.calls).toEqual([{ fan: 80 }, { heater: 50 }]);

        d.resolve({ heater: 50 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pB).resolves.toEqual({ heater: 50 });
    });

    it('같은 role의 대기 값을 C가 대체하면 B는 성공이 아니고 C만 전송한다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('fan', 80);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        sender.queue('heater', 50);
        const pB = sender.commitNow();
        sender.queue('heater', 70);
        const pC = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        expect(d.calls).toEqual([{ fan: 80 }]);
        await expect(pB).resolves.toBeNull();
        expect((await peek(pC)).done).toBe(false);

        d.resolve({ fan: 80 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toEqual({ fan: 80 });
        expect(d.calls).toEqual([{ fan: 80 }, { heater: 70 }]);

        d.resolve({ heater: 70 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pC).resolves.toEqual({ heater: 70 });
    });

    it('혼합 snapshot에서 role 하나만 바뀌면 나머지 role 결과는 원래 commit에 남는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('drum', 10);
        const pDrum = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        sender.queue('heater', 60);
        sender.queue('fan', 80);
        const pMixed = sender.commitNow();
        sender.queue('fan', 90);
        const pFan = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        expect(d.calls).toEqual([{ drum: 10 }]);
        expect((await peek(pMixed)).done).toBe(false);
        expect((await peek(pFan)).done).toBe(false);

        d.resolve({ drum: 10 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pDrum).resolves.toEqual({ drum: 10 });
        expect(d.calls).toEqual([{ drum: 10 }, { heater: 60, fan: 90 }]);

        d.resolve({ heater: 60, fan: 90 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pMixed).resolves.toEqual({ heater: 60 });
        await expect(pFan).resolves.toEqual({ fan: 90 });
    });

    it('빈 commit은 대기 중인 요청값을 성공으로 돌려주지 않는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('fan', 80);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 50);
        const pB = sender.commitNow();

        const pEmpty = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        await expect(pEmpty).resolves.toEqual({});
        expect((await peek(pB)).done).toBe(false);
        expect(d.calls).toEqual([{ fan: 80 }]);

        d.resolve({ fan: 80 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toEqual({ fan: 80 });
        expect(d.calls).toEqual([{ fan: 80 }, { heater: 50 }]);
        d.resolve({ heater: 50 });
        await expect(pB).resolves.toEqual({ heater: 50 });
    });

    it('clamp된 applied와 heater=0을 성공으로 반환한다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => {
            if (cmd.heater === 150) return { heater: 100 };
            return cmd;
        });
        const sender = createControlSender({ send });

        sender.queue('heater', 150);
        await expect(sender.commitNow()).resolves.toEqual({ heater: 100 });

        sender.queue('heater', 0);
        await expect(sender.commitNow()).resolves.toEqual({ heater: 0 });
    });

    it('요청한 heater가 applied에 없으면 성공이 아니다', async () => {
        const sender = createControlSender({ send: async () => ({ fan: 40 }) });
        sender.queue('heater', 50);
        await expect(sender.commitNow()).resolves.toBeNull();
    });

    it('dispose는 in-flight·대기 Promise를 남기지 않는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('fan', 80);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 50);
        const pB = sender.commitNow();

        sender.dispose();
        await expect(pA).resolves.toBeNull();
        await expect(pB).resolves.toBeNull();

        d.resolve({ fan: 80 });
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ fan: 80 }]);
    });

    it('같은 값의 대기 요청은 in-flight 성공을 가로채지 않는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('heater', 60);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 60);
        const pB = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        d.resolve({ heater: 60 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toEqual({ heater: 60 });
        expect((await peek(pB)).done).toBe(false);
        expect(d.calls).toEqual([{ heater: 60 }, { heater: 60 }]);

        d.resolve({ heater: 60 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pB).resolves.toEqual({ heater: 60 });
    });

    it('같은 값 대기 중 in-flight 실패는 대기 요청을 실패로 만들지 않는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('heater', 60);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 60);
        const pB = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        d.reject(new Error('first failed'));
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toBeNull();
        expect((await peek(pB)).done).toBe(false);

        d.resolve({ heater: 60 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pB).resolves.toEqual({ heater: 60 });
    });

    it('in-flight A와 같은 값 대기 B 위에 C가 오면 A는 유지되고 B만 대체된다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('heater', 60);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 60);
        const pB = sender.commitNow();
        sender.queue('heater', 70);
        const pC = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        await expect(pB).resolves.toBeNull();
        expect((await peek(pC)).done).toBe(false);

        d.resolve({ heater: 60 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pA).resolves.toEqual({ heater: 60 });
        expect(d.calls).toEqual([{ heater: 60 }, { heater: 70 }]);

        d.resolve({ heater: 70 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pC).resolves.toEqual({ heater: 70 });
    });

    it('dispose 중 in-flight가 끝나도 그 뒤 commit은 전송된다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });

        sender.queue('fan', 80);
        const pA = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        sender.dispose();
        await expect(pA).resolves.toBeNull();

        sender.queue('heater', 50);
        const pB = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ fan: 80 }]);
        expect((await peek(pB)).done).toBe(false);

        d.resolve({ fan: 80 });
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ fan: 80 }, { heater: 50 }]);

        d.resolve({ heater: 50 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pB).resolves.toEqual({ heater: 50 });
    });

    it('onApplied 예외가 있어도 commit Promise는 settle된다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({
            send,
            onApplied: () => {
                throw new Error('toast down');
            },
        });
        sender.queue('heater', 40);
        await expect(sender.commitNow()).resolves.toEqual({ heater: 40 });
    });
});

describe('createControlSender 미전송 Replay heater 취소 (#368 R03)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    const fanInFlight = async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });
        sender.queue('fan', 80);
        const pFan = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        return { d, sender, pFan };
    };

    const heaterInFlight = async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });
        sender.queue('heater', 10);
        const pHeater = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        return { d, sender, pHeater };
    };

    const queueReplay = (sender: ReturnType<typeof createControlSender>, value = 60) => {
        sender.queue('heater', value);
        return sender.commitNow('replay');
    };

    const cancelReplay = (sender: ReturnType<typeof createControlSender>) =>
        sender.cancelUnsent({ origin: 'replay', role: 'heater' });

    const flushFan = async (
        d: ReturnType<typeof deferredSend>,
        pFan: Promise<ControlCommand | null>,
        next?: ControlCommand,
    ) => {
        d.resolve({ fan: 80 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pFan).resolves.toEqual({ fan: 80 });
        if (next) expect(d.calls[d.calls.length - 1]).toEqual(next);
    };

    it('fan 전송 중 Replay heater 대기는 취소하면 보내지 않고 즉시 settle된다', async () => {
        const { d, sender, pFan } = await fanInFlight();
        const pReplay = queueReplay(sender);
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ fan: 80 }]);

        cancelReplay(sender);
        await expect(pReplay).resolves.toBeNull();
        expect((await peek(pFan)).done).toBe(false);

        await flushFan(d, pFan);
        expect(d.calls).toEqual([{ fan: 80 }]);
    });

    it('Replay 취소 뒤 수동 heater commit은 보존되어 전송된다', async () => {
        const { d, sender, pFan } = await fanInFlight();
        const pReplay = queueReplay(sender);
        cancelReplay(sender);
        await expect(pReplay).resolves.toBeNull();

        sender.queue('heater', 70);
        const pManual = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        await flushFan(d, pFan, { heater: 70 });
        d.resolve({ heater: 70 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pManual).resolves.toEqual({ heater: 70 });
    });

    it('fan/drum 대기는 Replay heater 취소에 휩쓸리지 않는다', async () => {
        const { d, sender, pHeater } = await heaterInFlight();
        sender.queue('fan', 80);
        const pFan = sender.commitNow();
        sender.queue('drum', 40);
        const pDrum = sender.commitNow();
        const pReplay = queueReplay(sender);
        await vi.advanceTimersByTimeAsync(0);

        cancelReplay(sender);
        await expect(pReplay).resolves.toBeNull();
        expect((await peek(pFan)).done).toBe(false);
        expect((await peek(pDrum)).done).toBe(false);

        d.resolve({ heater: 10 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pHeater).resolves.toEqual({ heater: 10 });
        expect(d.calls).toEqual([{ heater: 10 }, { fan: 80, drum: 40 }]);

        d.resolve({ fan: 80, drum: 40 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pFan).resolves.toEqual({ fan: 80 });
        await expect(pDrum).resolves.toEqual({ drum: 40 });
    });

    it('Replay 취소 뒤 DROP zero(safety)는 보존되어 전송된다', async () => {
        const { d, sender, pFan } = await fanInFlight();
        const pReplay = queueReplay(sender);
        cancelReplay(sender);
        await expect(pReplay).resolves.toBeNull();

        sender.queue('heater', 0);
        const pZero = sender.commitNow('safety');
        await vi.advanceTimersByTimeAsync(0);

        await flushFan(d, pFan, { heater: 0 });
        d.resolve({ heater: 0 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pZero).resolves.toEqual({ heater: 0 });
    });

    it('이미 큐에 있는 DROP zero는 Replay 취소로 지워지지 않는다', async () => {
        const { d, sender, pFan } = await fanInFlight();
        sender.queue('heater', 0);
        const pZero = sender.commitNow('safety');
        cancelReplay(sender);
        expect((await peek(pZero)).done).toBe(false);

        await flushFan(d, pFan, { heater: 0 });
        d.resolve({ heater: 0 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pZero).resolves.toEqual({ heater: 0 });
    });

    it('부분 대체된 fan은 Replay 취소 때 committed에서 사라지지 않는다', async () => {
        const { d, sender, pHeater } = await heaterInFlight();
        sender.queue('fan', 80);
        sender.queue('drum', 40);
        const pFanDrum = sender.commitNow();
        sender.queue('drum', 50);
        const pDrum = sender.commitNow();
        const pReplay = queueReplay(sender);
        expect((await peek(pFanDrum)).done).toBe(false);
        await vi.advanceTimersByTimeAsync(0);

        cancelReplay(sender);
        await expect(pReplay).resolves.toBeNull();

        d.resolve({ heater: 10 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pHeater).resolves.toEqual({ heater: 10 });
        expect(d.calls).toEqual([{ heater: 10 }, { fan: 80, drum: 50 }]);

        d.resolve({ fan: 80, drum: 50 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pFanDrum).resolves.toEqual({ fan: 80 });
        await expect(pDrum).resolves.toEqual({ drum: 50 });
    });

    it('이미 전송된 Replay heater는 취소됐다고 표시하지 않는다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });
        sender.queue('heater', 60);
        const pSent = sender.commitNow('replay');
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ heater: 60 }]);

        cancelReplay(sender);
        expect((await peek(pSent)).done).toBe(false);

        d.resolve({ heater: 60 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pSent).resolves.toEqual({ heater: 60 });
    });

    it('혼합 snapshot에서 fan만 교체한 뒤 Replay 취소는 heater를 안 보내고 manual fan은 보낸다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send });
        sender.queue('drum', 10);
        const pDrum = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);

        sender.queue('fan', 80);
        sender.queue('heater', 50);
        const pReplay = sender.commitNow('replay');
        await vi.advanceTimersByTimeAsync(0);

        sender.queue('fan', 90);
        const pFan = sender.commitNow();
        await vi.advanceTimersByTimeAsync(0);
        expect((await peek(pReplay)).done).toBe(false);

        expect(cancelReplay(sender)).toEqual([{ heater: 50 }]);
        await expect(pReplay).resolves.toBeNull();

        d.resolve({ drum: 10 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pDrum).resolves.toEqual({ drum: 10 });
        expect(d.calls).toEqual([{ drum: 10 }, { fan: 90 }]);

        d.resolve({ fan: 90 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pFan).resolves.toEqual({ fan: 90 });
    });

    it('혼합 Replay snapshot을 직접 취소해도 fan/drum은 남긴다', async () => {
        const { d, sender, pHeater } = await heaterInFlight();
        sender.queue('fan', 80);
        sender.queue('drum', 40);
        sender.queue('heater', 50);
        const pReplay = sender.commitNow('replay');
        await vi.advanceTimersByTimeAsync(0);

        expect(cancelReplay(sender)).toEqual([{ heater: 50 }]);
        await expect(pReplay).resolves.toBeNull();

        d.resolve({ heater: 10 });
        await vi.advanceTimersByTimeAsync(0);
        await expect(pHeater).resolves.toEqual({ heater: 10 });
        expect(d.calls).toEqual([{ heater: 10 }, { fan: 80, drum: 40 }]);
        expect(d.calls.some((cmd) => cmd.heater === 50)).toBe(false);
    });
});

describe('applied control chart observers', () => {
    it('notifies only after ACK with the clamped values, and keeps the observer from the sent request', async () => {
        const d = deferredSend();
        const first = vi.fn();
        const nextSession = vi.fn();
        const sender = createControlSender({ send: d.send, onApplied: first });
        sender.queue('heater', 120);
        const pending = sender.commitNow();
        expect(first).not.toHaveBeenCalled();
        sender.setOnApplied(nextSession);
        d.resolve({ heater: 100 });
        await pending;
        expect(first).toHaveBeenCalledWith({ heater: 100 });
        expect(nextSession).not.toHaveBeenCalled();
        sender.queue('fan', 50);
        const failed = sender.commitNow();
        d.reject(new Error('write failed'));
        await expect(failed).resolves.toBeNull();
        expect(nextSession).not.toHaveBeenCalled();
    });
    it('does not notify a disposed generation', async () => {
        const d = deferredSend();
        const onApplied = vi.fn();
        const sender = createControlSender({ send: d.send, onApplied });
        sender.queue('drum', 55);
        const pending = sender.commitNow();
        sender.dispose();
        d.resolve({ drum: 55 });
        await pending;
        await Promise.resolve();
        expect(onApplied).not.toHaveBeenCalled();
    });
});
