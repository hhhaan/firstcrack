export type ControlRole = 'heater' | 'fan' | 'drum';
export type ControlCommand = Partial<Record<ControlRole, number>>;

/**
 * 기기가 지시값을 따라잡은 role 목록.
 *
 * 여기서 걸러진 role은 지시를 버려 슬라이더가 기기 실측을 따라가게 된다. 이 판정이
 * 영영 참이 되지 않으면 슬라이더가 사용자 값에 고정돼, 본체 조작반에서 화력을
 * 바꿔도 화면이 그대로다.
 */
export const settledRoles = (
    desired: ControlCommand,
    feedback: Record<ControlRole, number>,
    tolerance: number,
): ControlRole[] =>
    (['heater', 'fan', 'drum'] as ControlRole[]).filter((role) => {
        const target = desired[role];
        return target != null && Math.abs(target - feedback[role]) <= tolerance;
    });

interface Options {
    send: (cmd: ControlCommand) => Promise<ControlCommand>;
    /** 전송 성공 시 사이드카가 범위로 자른 실제 값 */
    onApplied?: (applied: ControlCommand) => void;
    onError?: (err: unknown) => void;
    onSendingChange?: (sending: boolean) => void;
}

/**
 * 제어 명령 전송기 — 손 뗄 때만 전송 + 순서 보장.
 *
 * 드래그 중간값은 기기에 보내지 않는다. 보내면 가스 밸브·팬이 실제로 그 값들을
 * 거쳐 가고(기계적 낭비), 그 궤적이 로스팅 기록 차트에 톱니로 남는다. 차트는
 * 기기 실측을 그리므로 차트 쪽을 걸러 봐야 소용없다 — 애초에 안 보내는 게 답이다.
 *
 * 요청을 동시에 두 개 띄우지 않는다. 전송 중에 새 값이 들어오면 pending에 모아
 * 두었다가 끝난 뒤 한 번 더 보낸다. 동시에 보내면 PLC 도착 순서가 뒤집혀 히터가
 * 사용자가 마지막으로 지시한 값이 아닌 옛 값에 머무를 수 있다.
 */
export const createControlSender = ({ send, onApplied, onError, onSendingChange }: Options) => {
    // draft(드래그 중인 값)와 committed(손을 떼 전송이 확정된 값)를 분리한다.
    // 한 큐로 겸하면, A 전송 중 드래그로 쌓인 중간값을 A 응답의 finally가
    // 커밋 없이 자동 전송해 "손 뗄 때만 전송" 계약이 깨진다(#269).
    let draft: ControlCommand = {};
    let committed: ControlCommand = {};
    let inFlight = false;
    // dispose 세대 — 폐기 이후에 도착한 응답의 콜백을 무시한다. 그러지 않으면
    // 연결이 끊겨 상태를 비운 뒤에 늦게 온 응답이 옛 setpoint를 되살린다.
    let generation = 0;

    const flush = async (): Promise<void> => {
        if (inFlight) return;
        const cmd = committed;
        if (Object.keys(cmd).length === 0) return;
        const gen = generation;
        committed = {};
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
                if (Object.keys(committed).length > 0) await flush();
            }
        }
    };

    return {
        /** 값 변경 — 화면만 따라가고 전송은 하지 않는다. 보내려면 commitNow. */
        queue(role: ControlRole, value: number): void {
            draft = { ...draft, [role]: value };
        },
        /** 슬라이더에서 손을 뗀 순간 — 그때까지의 draft를 확정해 전송 */
        commitNow(): Promise<void> {
            committed = { ...committed, ...draft };
            draft = {};
            return flush();
        },
        dispose(): void {
            draft = {};
            committed = {};
            generation += 1; // 진행 중인 요청의 콜백을 무효화한다
        },
    };
};
