export type ControlRole = 'heater' | 'fan' | 'drum';
export type ControlCommand = Partial<Record<ControlRole, number>>;
/** commit 출처 — Replay 자동화 중단 시 미전송 heater만 고른다. safety는 DROP zero. */
export type ControlOrigin = 'manual' | 'replay' | 'safety';
export interface ControlRetry {
    connectionEpoch: number;
}

export interface ControlSendObserver {
    dispatched: (command: ControlCommand, origins: Partial<Record<ControlRole, ControlOrigin>>) => void;
    applied: (requested: ControlCommand, applied: ControlCommand) => void;
    failed: (requested: ControlCommand) => void;
}

export interface CancelUnsentMatch {
    origin: ControlOrigin;
    role: ControlRole;
}

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
    send: (cmd: ControlCommand, retry?: ControlRetry) => Promise<ControlCommand>;
    observer?: ControlSendObserver;
    /** 사용자가 전송을 확정한 값. 전송 성공 여부와 무관하게 commit당 한 번 호출한다. */
    onCommitted?: (committed: ControlCommand) => void;
    /** 전송 성공 시 사이드카가 범위로 자른 실제 값 */
    onApplied?: (applied: ControlCommand) => void;
    onError?: (err: unknown, origins?: Partial<Record<ControlRole, ControlOrigin>>) => void;
    onSendingChange?: (sending: boolean) => void;
}

interface Waiter {
    requested: ControlCommand;
    origin: ControlOrigin;
    retry?: ControlRetry;
    resolve: (result: ControlCommand | null) => void;
    settled: boolean;
}

const rolesOf = (cmd: ControlCommand): ControlRole[] => Object.keys(cmd) as ControlRole[];

const omitRoles = (cmd: ControlCommand, drop: ReadonlySet<ControlRole>): ControlCommand => {
    const out: ControlCommand = {};
    for (const role of rolesOf(cmd)) {
        if (!drop.has(role)) out[role] = cmd[role];
    }
    return out;
};

const mergeQueued = (waiters: Waiter[]): ControlCommand => {
    let next: ControlCommand = {};
    for (const waiter of waiters) next = { ...next, ...waiter.requested };
    return next;
};

/** 겹친 role만 떼고 나머지는 같은 origin으로 남긴다. committed에 waiter 없는 값이 생기면 취소가 못 고른다. */
const keepLeftover = (waiter: Waiter, leftover: ControlCommand, into: Waiter[]) => {
    if (rolesOf(leftover).length === 0) return;
    into.push({
        requested: leftover,
        origin: waiter.origin,
        retry: waiter.retry,
        resolve: () => {},
        settled: true,
    });
};

/** 이 commit이 요청한 role만 applied에서 골라 귀속한다. 없으면 성공이 아니다. */
const pickApplied = (requested: ControlCommand, applied: ControlCommand): ControlCommand | null => {
    const out: ControlCommand = {};
    for (const role of rolesOf(requested)) {
        const value = applied[role];
        if (value != null) out[role] = value;
    }
    return rolesOf(out).length > 0 ? out : null;
};

const settle = (waiter: Waiter, result: ControlCommand | null) => {
    if (waiter.settled) return;
    waiter.settled = true;
    waiter.resolve(result);
};

const notify = (fn: () => void) => {
    try {
        fn();
    } catch {
        // observer 예외가 waiter settle / 다음 flush를 막으면 안 된다
    }
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
export const createControlSender = ({ send, observer, onCommitted, onApplied, onError, onSendingChange }: Options) => {
    // draft(드래그 중인 값)와 committed(손을 떼 전송이 확정된 값)를 분리한다.
    // 한 큐로 겸하면, A 전송 중 드래그로 쌓인 중간값을 A 응답의 finally가
    // 커밋 없이 자동 전송해 "손 뗄 때만 전송" 계약이 깨진다(#269).
    let draft: ControlCommand = {};
    let committed: ControlCommand = {};
    let queuedWaiters: Waiter[] = [];
    let inFlightWaiters: Waiter[] = [];
    let inFlight = false;
    let committedListener = onCommitted;
    let appliedListener = onApplied;
    let sendObserver = observer;
    // dispose 세대 — 폐기 이후에 도착한 응답의 콜백을 무시한다. 그러지 않으면
    // 연결이 끊겨 상태를 비운 뒤에 늦게 온 응답이 옛 setpoint를 되살린다.
    let generation = 0;

    const flush = async (): Promise<void> => {
        if (inFlight) return;
        if (Object.keys(committed).length === 0) return;
        const gen = generation;
        // A late ACK belongs to the observer/session that sent the command.
        const appliedObserver = appliedListener;
        const transmissionObserver = sendObserver;
        // A guarded retry must not inherit unrelated manual/fan/drum commands.
        const retry = queuedWaiters[0]?.retry;
        const count = retry ? 1 : queuedWaiters.findIndex((waiter) => waiter.retry != null);
        const sentWaiters = queuedWaiters.slice(0, count < 0 ? undefined : count);
        const cmd = mergeQueued(sentWaiters);
        const origins: Partial<Record<ControlRole, ControlOrigin>> = {};
        for (const waiter of sentWaiters) {
            for (const role of rolesOf(waiter.requested)) origins[role] = waiter.origin;
        }
        queuedWaiters = queuedWaiters.slice(sentWaiters.length);
        committed = mergeQueued(queuedWaiters);
        inFlightWaiters = sentWaiters;
        inFlight = true;
        notify(() => onSendingChange?.(true));
        notify(() => transmissionObserver?.dispatched(cmd, origins));
        try {
            const applied = await (retry ? send(cmd, retry) : send(cmd));
            if (gen === generation) {
                notify(() => transmissionObserver?.applied(cmd, applied));
                for (const waiter of sentWaiters) {
                    settle(waiter, pickApplied(waiter.requested, applied));
                }
                inFlightWaiters = [];
                notify(() => appliedObserver?.(applied));
            }
        } catch (err) {
            if (gen === generation) {
                notify(() => transmissionObserver?.failed(cmd));
                for (const waiter of sentWaiters) settle(waiter, null);
                inFlightWaiters = [];
                notify(() => onError?.(err, origins));
            }
        } finally {
            inFlight = false;
            if (gen === generation) notify(() => onSendingChange?.(false));
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
        /**
         * 슬라이더에서 손을 뗀 순간 — 그때까지의 draft를 확정해 전송.
         * 성공 시 이 요청이 포함된 실제 applied(요청 role만), 실패·같은 role 대체·dispose·미전송 취소 시 null.
         * 같은 role 일부만 대체되면 겹친 role은 성공이 아니고, 남은 role은 실제 전송 결과에 귀속한다.
         * 빈 commit은 즉시 `{}` — 대기 중인 다른 요청의 성공을 만들지 않는다.
         */
        commitNow(origin: ControlOrigin = 'manual', retry?: ControlRetry): Promise<ControlCommand | null> {
            const snapshot = retry ? (draft.heater == null ? {} : { heater: draft.heater }) : draft;
            draft = retry ? omitRoles(draft, new Set(['heater'])) : {};
            if (Object.keys(snapshot).length === 0) {
                void flush();
                return Promise.resolve({});
            }
            committedListener?.(snapshot);
            const replaced = new Set(rolesOf(snapshot));
            const remaining: Waiter[] = [];
            for (const waiter of queuedWaiters) {
                if (!rolesOf(waiter.requested).some((role) => replaced.has(role))) {
                    remaining.push(waiter);
                    continue;
                }
                const leftover = omitRoles(waiter.requested, replaced);
                if (rolesOf(leftover).length === 0) {
                    settle(waiter, null);
                    continue;
                }
                waiter.requested = leftover;
                remaining.push(waiter);
            }
            return new Promise((resolve) => {
                remaining.push({ requested: snapshot, origin, retry, resolve, settled: false });
                queuedWaiters = remaining;
                committed = mergeQueued(queuedWaiters);
                void flush();
            });
        },
        /**
         * 아직 안 보낸 대기만 고른다. in-flight(이미 PLC로 나간 것)는 건드리지 않는다.
         * 매칭 role만 취소하고 같은 waiter의 fan/drum은 origin을 유지한 채 남긴다.
         */
        cancelUnsent({ origin, role }: CancelUnsentMatch): ControlCommand[] {
            const cancelled: ControlCommand[] = [];
            const remaining: Waiter[] = [];
            for (const waiter of queuedWaiters) {
                const value = waiter.origin === origin ? waiter.requested[role] : undefined;
                if (value == null) {
                    remaining.push(waiter);
                    continue;
                }
                settle(waiter, null);
                cancelled.push({ [role]: value });
                keepLeftover(waiter, omitRoles(waiter.requested, new Set([role])), remaining);
            }
            queuedWaiters = remaining;
            committed = mergeQueued(queuedWaiters);
            return cancelled;
        },
        dispose(): void {
            draft = {};
            committed = {};
            generation += 1; // 진행 중인 요청의 콜백을 무효화한다
            const pending = [...queuedWaiters, ...inFlightWaiters];
            queuedWaiters = [];
            inFlightWaiters = [];
            for (const waiter of pending) settle(waiter, null);
        },
        setOnCommitted(callback?: (command: ControlCommand) => void): void {
            committedListener = callback;
        },
        setOnApplied(callback?: (command: ControlCommand) => void): void {
            appliedListener = callback;
        },
        setObserver(observer?: ControlSendObserver): void {
            sendObserver = observer;
        },
    };
};
