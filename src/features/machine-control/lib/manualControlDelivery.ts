import { deliverCommand } from './commandDelivery';
import type { ControlCommand, ControlRetry, ControlRole } from './controlTypes';
import { deliverHeaterCommand } from './heaterDelivery';

/** Send the batch once, then recover only eligible roles, one request at a time. */
export const deliverManualControls = async ({
    command,
    send,
    epochs,
    controllers,
}: {
    command: ControlCommand;
    send: (command: ControlCommand, retry?: ControlRetry) => Promise<ControlCommand>;
    epochs: Partial<Record<ControlRole, number>>;
    controllers: Partial<Record<ControlRole, AbortController>>;
}) => {
    let applied: ControlCommand = {};
    let initialError: unknown;
    const errors: Partial<Record<ControlRole, unknown>> = {};
    // Handle rejection immediately, even if the first eligible role is cancelled.
    const first = send(command).then(
        (result) => {
            applied = result;
            return result;
        },
        (error: unknown) => {
            initialError = error;
            return {} as ControlCommand;
        },
    );
    const roles = Object.keys(command) as ControlRole[];
    for (const role of roles) {
        const controller = controllers[role];
        const connectionEpoch = epochs[role];
        const target = command[role];
        if (!controller || connectionEpoch == null || target == null) continue;
        const options = {
            target,
            signal: controller.signal,
            write: async () => (await first)[role] ?? null,
            retry: async () => {
                try {
                    const result = await send({ [role]: target }, { connectionEpoch });
                    if (result[role] != null) applied = { ...applied, [role]: result[role] };
                    return result[role] ?? null;
                } catch (error) {
                    errors[role] = error;
                    return null;
                }
            },
        };
        if (role === 'heater') {
            await deliverHeaterCommand({ ...options, origin: 'manual', connectionEpoch, onAttempt: () => {} });
        } else {
            await deliverCommand({ ...options, acceptClamped: true });
        }
    }
    await first;
    const cancelled = new Set(roles.filter((role) => controllers[role]?.signal.aborted));
    applied = Object.fromEntries(Object.entries(applied).filter(([role]) => !cancelled.has(role as ControlRole)));
    const missing = roles.filter((role) => !cancelled.has(role) && applied[role] == null);
    return {
        applied,
        cancelled,
        missing,
        error: errors[missing[0]] ?? initialError ?? new Error('제어 명령 전달을 확인하지 못했습니다.'),
    };
};
