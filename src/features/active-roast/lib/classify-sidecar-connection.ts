/**
 * Sidecar poll/status → roasting-store connection flags.
 *
 * Hard disconnect (connected=false) resets preheating/standby in ActiveRoast.
 * Auto-reconnect and transient poll blips must NOT go through that path.
 */

export type SidecarConnectionKind =
    /** /temperatures returned a usable BT sample */
    | 'live'
    /** /temperatures returned bt=null (or equivalent) — need status to classify */
    | 'null_bt'
    /** /temperatures threw (timeout/network) — need status if available */
    | 'poll_error';

export type SidecarConnectionSignals = {
    kind: SidecarConnectionKind;
    /** From temperature payload when present */
    dataReconnecting?: boolean;
    status?: {
        connected?: boolean;
        reconnecting?: boolean;
        error?: string | null;
    } | null;
};

export type SidecarConnectionDecision = {
    /** Store sidecarConnected — false only for hard disconnect */
    connected: boolean;
    reconnecting: boolean;
    error: string | null;
};

/**
 * Classify connection for session hold vs hard disconnect.
 *
 * - live → connected
 * - hardware auto-reconnect (reconnecting) → connected + reconnecting (session hold)
 * - status still connected after a blip → connected
 * - status missing / idle disconnect → hard disconnect
 */
export function classifySidecarConnection(signals: SidecarConnectionSignals): SidecarConnectionDecision {
    if (signals.kind === 'live') {
        return {
            connected: true,
            reconnecting: Boolean(signals.dataReconnecting),
            error: null,
        };
    }

    const status = signals.status;
    const statusConnected = status?.connected === true;
    const reconnecting = Boolean(status?.reconnecting ?? signals.dataReconnecting);
    const error = status?.error ?? null;

    // Still linked, or sidecar is actively recovering the hardware link
    if (statusConnected || reconnecting) {
        return {
            connected: true,
            reconnecting: reconnecting || !statusConnected,
            error: reconnecting ? error : null,
        };
    }

    // Explicit not-connected (user disconnect / idle) or status unreachable after poll error
    return {
        connected: false,
        reconnecting: false,
        error,
    };
}
