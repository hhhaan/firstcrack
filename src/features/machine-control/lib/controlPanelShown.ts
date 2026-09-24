import type { ControlRole } from './controlSender';

/** Display order of the manual channels. Send order lives in the control sender. */
export const MACHINE_CONTROL_CHANNEL_ROLES: ControlRole[] = ['heater', 'fan', 'drum'];

/**
 * Whether the control panel is on screen.
 *
 * This is a display gate. Whether a write is allowed stays on the control model
 * (`writable` and the sender). A PID that is not off stays visible so fault text
 * and the release control are not hidden by plan loading or a read-only link.
 */
export const isMachineControlPanelShown = (input: {
    pidActive: boolean;
    entitled: boolean;
    writable: boolean;
    hasChannel: boolean;
}): boolean => input.pidActive || (input.entitled && input.writable && input.hasChannel);
