export type ControlRole = 'heater' | 'fan' | 'drum';
export type ControlCommand = Partial<Record<ControlRole, number>>;

/** 기기 실측이 지시값에 이만큼 근접하면 "따라왔다"고 본다 (채널 단위) */
export const CONVERGE_TOLERANCE = 1;

/**
 * 기기가 지시값을 따라잡은 role 목록.
 *
 * 여기서 걸러진 role은 지시를 버려 슬라이더가 기기 실측을 따라가게 된다. 이 판정이
 * 영영 참이 되지 않으면 슬라이더가 사용자 값에 고정돼, 본체 조작반에서 화력을
 * 바꿔도 화면이 그대로다.
 */
export const settledRoles = (
    desired: ControlCommand,
    feedback: Record<ControlRole, number | null>,
    tolerance: number,
): ControlRole[] =>
    (['heater', 'fan', 'drum'] as ControlRole[]).filter((role) => {
        const target = desired[role];
        const fb = feedback[role];
        return target != null && fb != null && Math.abs(target - fb) <= tolerance;
    });

interface Options {
    send: (cmd: ControlCommand) => Promise<ControlCommand>;
    /** 사용자가 전송을 확정한 값. 전송 성공 여부와 무관하게 commit당 한 번 호출한다. */
    onCommitted?: (committed: ControlCommand) => void;
    /** 전송 성공 시 사이드카가 범위로 자른 실제 값 */
    onApplied?: (applied: ControlCommand) => void;
    onError?: (err: unknown) => void;
    onSendingChange?: (sending: boolean) => void;
}

interface Waiter {
    requested: ControlCommand;
    resolve: (result: ControlCommand | null) => void;
}

const rolesOf = (cmd: ControlCommand): ControlRole[] => Object.keys(cmd) as ControlRole[];

/** 이 commit이 요청한 role만 applied에서 골라 귀속한다. 없으면 성공이 아니다. */
const pickApplied = (requested: ControlCommand, applied: ControlCommand): ControlCommand | null => {
    const out: ControlCommand = {};
    for (const role of rolesOf(requested)) {
        const value = applied[role];
        if (value != null) out[role] = value;
    }
    return rolesOf(out).length > 0 ? out : null;
};

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
export const createControlSender = ({ send, onCommitted, onApplied, onError, onSendingChange }: Options) => {
    // draft(드래그 중인 값)와 committed(손을 떼 전송이 확정된 값)를 분리한다.
    // 한 큐로 겸하면, A 전송 중 드래그로 쌓인 중간값을 A 응답의 finally가
    // 커밋 없이 자동 전송해 "손 뗄 때만 전송" 계약이 깨진다(#269).
    let draft: ControlCommand = {};
    let committed: ControlCommand = {};
    let inFlight = false;
    let committedListener = onCommitted;
    let waiters: Waiter[] = [];
    // dispose 세대 — 폐기 이후에 도착한 응답의 콜백을 무시한다. 그러지 않으면
    // 연결이 끊겨 상태를 비운 뒤에 늦게 온 응답이 옛 setpoint를 되살린다.
    let generation = 0;

    const settleSent = (sent: ControlCommand, applied: ControlCommand | null) => {
        waiters = waiters.filter((waiter) => {
            const included = rolesOf(waiter.requested).every((role) => sent[role] === waiter.requested[role]);
            if (!included) return true;
            waiter.resolve(applied == null ? null : pickApplied(waiter.requested, applied));
            return false;
        });
    };

    /**
     * 성공 시 사이드카가 범위로 자른 applied, 실패·대체·dispose 시 null.
     * Replay는 실패한 이벤트를 소진하면 안 되고, lastWritten은 요청값이 아니라 applied다 (#376).
     * 각 commit Promise는 자신이 포함된 실제 전송 완료에 붙는다. in-flight 중 merge된
     * 요청값을 성공으로 돌려주지 않는다 (#368 R01).
     */
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
            if (gen === generation) {
                onApplied?.(applied);
                settleSent(cmd, applied);
            }
        } catch (err) {
            if (gen === generation) {
                onError?.(err);
                settleSent(cmd, null);
            }
        } finally {
            inFlight = false;
            if (gen === generation) onSendingChange?.(false);
            // 이 슬롯이 비면 현재 세대의 대기 명령을 보낸다. dispose 뒤 새 commit이
            // 옛 in-flight 뒤에 붙을 수 있으므로 generation이 달라도 비우면 flush한다.
            if (Object.keys(committed).length > 0) void flush();
        }
    };

    return {
        /** 값 변경 — 화면만 따라가고 전송은 하지 않는다. 보내려면 commitNow. */
        queue(role: ControlRole, value: number): void {
            draft = { ...draft, [role]: value };
        },
        /** 슬라이더에서 손을 뗀 순간 — 그때까지의 draft를 확정해 전송 */
        commitNow(): Promise<ControlCommand | null> {
            const snapshot = draft;
            draft = {};
            if (Object.keys(snapshot).length === 0) {
                void flush();
                return Promise.resolve({});
            }
            committedListener?.(snapshot);
            // 아직 안 보낸 committed만 같은 role 최신값으로 대체한다. in-flight waiter는
            // 이미 나간 전송의 결과를 받아야 한다.
            waiters = waiters.filter((waiter) => {
                const queued = rolesOf(waiter.requested).every((role) => committed[role] === waiter.requested[role]);
                if (!queued || !rolesOf(waiter.requested).some((role) => role in snapshot)) return true;
                waiter.resolve(null);
                return false;
            });
            committed = { ...committed, ...snapshot };
            return new Promise((resolve) => {
                waiters.push({ requested: snapshot, resolve });
                void flush();
            });
        },
        dispose(): void {
            draft = {};
            committed = {};
            generation += 1; // 진행 중인 요청의 콜백을 무효화한다
            const pending = waiters;
            waiters = [];
            for (const waiter of pending) waiter.resolve(null);
        },
        setOnCommitted(callback?: (command: ControlCommand) => void): void {
            committedListener = callback;
        },
    };
};
