import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ControlCommand, createControlSender } from './controlSender';

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

describe('createControlSender', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('debounce로 연속 변경을 한 번의 전송으로 모은다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send, debounceMs: 250 });

        sender.queue('heater', 10);
        sender.queue('heater', 20);
        sender.queue('heater', 30);
        expect(send).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(250);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ heater: 30 });
    });

    it('여러 role 변경을 하나의 명령으로 합친다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send, debounceMs: 250 });

        sender.queue('heater', 60);
        sender.queue('fan', 40);
        await vi.advanceTimersByTimeAsync(250);

        expect(send).toHaveBeenCalledWith({ heater: 60, fan: 40 });
    });

    it('commitNow는 debounce를 기다리지 않는다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send, debounceMs: 250 });

        sender.queue('heater', 70);
        await sender.commitNow();

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ heater: 70 });
    });

    it('전송 중에는 새 요청을 겹쳐 보내지 않고, 끝난 뒤 최신값만 보낸다', async () => {
        const d = deferredSend();
        const sender = createControlSender({ send: d.send, debounceMs: 0 });

        sender.queue('heater', 10);
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toEqual([{ heater: 10 }]);

        // 첫 요청이 아직 응답 전 — 사용자가 슬라이더를 더 움직였다
        sender.queue('heater', 55);
        await vi.advanceTimersByTimeAsync(0);
        sender.queue('heater', 80);
        await vi.advanceTimersByTimeAsync(0);
        expect(d.calls).toHaveLength(1); // 아직 겹쳐 보내지 않았다

        d.resolve();
        await vi.advanceTimersByTimeAsync(0);

        // 중간값 55는 건너뛰고 마지막 지시값만 전송 — 도착 순서 역전 방지
        expect(d.calls).toEqual([{ heater: 10 }, { heater: 80 }]);
    });

    it('사이드카가 자른 값을 onApplied로 돌려준다', async () => {
        const onApplied = vi.fn();
        const sender = createControlSender({
            send: async () => ({ heater: 100 }),
            onApplied,
            debounceMs: 0,
        });

        sender.queue('heater', 150);
        await vi.advanceTimersByTimeAsync(0);

        expect(onApplied).toHaveBeenCalledWith({ heater: 100 });
    });

    it('전송 실패를 onError로 알리고 이후 전송을 막지 않는다', async () => {
        const onError = vi.fn();
        let shouldFail = true;
        const send = vi.fn(async (cmd: ControlCommand) => {
            if (shouldFail) throw new Error('409');
            return cmd;
        });
        const sender = createControlSender({ send, onError, debounceMs: 0 });

        sender.queue('heater', 50);
        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalledTimes(1);

        shouldFail = false;
        sender.queue('heater', 60);
        await vi.advanceTimersByTimeAsync(0);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('dispose 후에는 예약된 전송이 나가지 않는다', async () => {
        const send = vi.fn(async (cmd: ControlCommand) => cmd);
        const sender = createControlSender({ send, debounceMs: 250 });

        sender.queue('heater', 50);
        sender.dispose();
        await vi.advanceTimersByTimeAsync(500);

        expect(send).not.toHaveBeenCalled();
    });
});
