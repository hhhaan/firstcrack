export type ControlRole = 'heater' | 'fan' | 'drum';
export type ControlCommand = Partial<Record<ControlRole, number>>;

/** 슬라이더를 끄는 동안 매 픽셀마다 PLC에 쓰지 않도록 커밋을 모으는 간격 */
export const COMMIT_DEBOUNCE_MS = 250;

interface Options {
    send: (cmd: ControlCommand) => Promise<ControlCommand>;
    /** 전송 성공 시 사이드카가 범위로 자른 실제 값 */
    onApplied?: (applied: ControlCommand) => void;
    onError?: (err: unknown) => void;
    onSendingChange?: (sending: boolean) => void;
    debounceMs?: number;
}

/**
 * 제어 명령 전송기 — debounce + 순서 보장.
 *
 * 요청을 동시에 두 개 띄우지 않는다. 전송 중에 새 값이 들어오면 pending에 모아
 * 두었다가 끝난 뒤 한 번 더 보낸다. 동시에 보내면 PLC 도착 순서가 뒤집혀 히터가
 * 사용자가 마지막으로 지시한 값이 아닌 옛 값에 머무를 수 있다.
 */
export const createControlSender = ({
    send,
    onApplied,
    onError,
    onSendingChange,
    debounceMs = COMMIT_DEBOUNCE_MS,
}: Options) => {
    let pending: ControlCommand = {};
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // dispose 세대 — 폐기 이후에 도착한 응답의 콜백을 무시한다. 그러지 않으면
    // 연결이 끊겨 상태를 비운 뒤에 늦게 온 응답이 옛 setpoint를 되살린다.
    let generation = 0;

    const flush = async (): Promise<void> => {
        if (inFlight) return;
        const cmd = pending;
        if (Object.keys(cmd).length === 0) return;
        const gen = generation;
        pending = {};
        inFlight = true;
        onSendingChange?.(true);
        try {
            const applied = await send(cmd);
            if (gen === generation) onApplied?.(applied);
        } catch (err) {
            if (gen === generation) onError?.(err);
        } finally {
            inFlight = false;
            if (gen === generation) {
                onSendingChange?.(false);
                if (Object.keys(pending).length > 0) await flush();
            }
        }
    };

    return {
        /** 값 변경 — debounce 후 전송 */
        queue(role: ControlRole, value: number): void {
            pending = { ...pending, [role]: value };
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void flush(), debounceMs);
        },
        /** 슬라이더에서 손을 뗀 순간 — debounce를 기다리지 않고 즉시 전송 */
        commitNow(): Promise<void> {
            if (timer) clearTimeout(timer);
            timer = null;
            return flush();
        },
        dispose(): void {
            if (timer) clearTimeout(timer);
            timer = null;
            pending = {};
            generation += 1; // 진행 중인 요청의 콜백을 무효화한다
        },
    };
};
