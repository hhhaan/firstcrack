import type { MachineSnapshot } from '@entities/machine';
import type { RoastPhase } from '@features/active-roast/model/status';
import { ask } from '@tauri-apps/plugin-dialog';

/** Copy is fixed Korean, same as the roast-in-progress window-close dialog. */
export const ROAST_DISCONNECT_MESSAGE = '로스팅 중입니다. 정말로 연결을 해제하시겠습니까?';
export const ROAST_DISCONNECT_OK = '연결 해제';
export const ROAST_DISCONNECT_CANCEL = '취소';
export const ROAST_DISCONNECT_TITLE = '연결 해제';

export type RoastDisconnectSession = {
    phase: RoastPhase;
    machineSnapshot: Pick<MachineSnapshot, 'machine_id' | 'machine_roaster_key'> | null;
};

export type DisconnectMachineRef = {
    id: string;
    roasterKey: string;
};

/**
 * A roast is in progress only after Charge and before Drop (`phase === 'roasting'`).
 * Charge-wait is `preheating` / `standby`. Those disconnect immediately.
 */
const isActiveRoastPhase = (phase: RoastPhase): boolean => phase === 'roasting';

/**
 * Confirm when this disconnect would drop the machine the live roast is using.
 * Another machine (snapshot id, else roaster key) keeps the existing immediate disconnect.
 * No snapshot yet: the live sidecar connection is the roast.
 */
const isDisconnectingRoastingMachine = (session: RoastDisconnectSession, machine: DisconnectMachineRef): boolean => {
    if (!isActiveRoastPhase(session.phase)) return false;
    const snap = session.machineSnapshot;
    if (snap?.machine_id) return snap.machine_id === machine.id;
    if (snap?.machine_roaster_key) return snap.machine_roaster_key === machine.roasterKey;
    return true;
};

/** Same probe as the quit and window-close prompts (`__TAURI_INTERNALS__`). */
const isTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const askNative = () =>
    ask(ROAST_DISCONNECT_MESSAGE, {
        title: ROAST_DISCONNECT_TITLE,
        kind: 'warning',
        okLabel: ROAST_DISCONNECT_OK,
        cancelLabel: ROAST_DISCONNECT_CANCEL,
    });

/** Tauri `ask` on desktop. `window.confirm` when that runtime is absent (Vite web QA). */
const confirmRoastDisconnect = async (): Promise<boolean> => {
    if (isTauriRuntime()) {
        try {
            return (await askNative()) === true;
        } catch {
            // Plugin missing in a webview that still set the Tauri flag.
        }
    }
    return window.confirm(ROAST_DISCONNECT_MESSAGE) === true;
};

/**
 * @returns whether the connection was released. Cancel / dialog close returns false
 * and does not call `disconnect`.
 */
export const disconnectMachineWithRoastGuard = async (args: {
    session: RoastDisconnectSession;
    machine: DisconnectMachineRef;
    disconnect: () => Promise<void>;
}): Promise<boolean> => {
    if (isDisconnectingRoastingMachine(args.session, args.machine)) {
        const ok = await confirmRoastDisconnect();
        if (!ok) return false;
    }
    await args.disconnect();
    return true;
};
