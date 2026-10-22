import { i18n } from '@shared/i18n';
import { sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import type {
    Charge,
    CurveAuthority,
    CurveSnapshot,
    CurveStopRequest,
    FrozenReference,
    SidecarStatus,
} from '@shared/types/sidecar';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface FsdControlInput {
    receiptStatus?: { unavailable: boolean; gaps: number; unresolved: number };
    reference: FrozenReference | null;
    referenceReason: string | null;
    referenceLoading: boolean;
    referenceTpTime?: number | null;
    acceptedCharge: Charge | null;
    sessionId: string | null;
    workspaceId: string | null;
    visible: boolean;
    entitled: boolean;
}

const sameAuthority = (left: CurveAuthority | null | undefined, right: CurveAuthority) =>
    left?.sensor_clock === right.sensor_clock && left.run_id === right.run_id && left.generation === right.generation;

const ownsHeater = (curve: CurveSnapshot | null | undefined) =>
    curve != null && (curve.phase !== 'terminal' || curve.terminal_outcome !== 'completed');

export const useFsdControl = ({
    input,
    status,
    healthy,
    fixedActive,
    replayActive,
    roastFinished,
}: {
    input?: FsdControlInput;
    status: SidecarStatus | null;
    healthy: boolean;
    fixedActive: boolean;
    replayActive: boolean;
    roastFinished: boolean;
}) => {
    const [snapshot, setSnapshot] = useState<{ curve: CurveSnapshot | null; time: number; clock: string | null }>({
        curve: null,
        time: -1,
        clock: null,
    });
    const [starting, setStarting] = useState(false);
    const [pendingStops, setPendingStops] = useState(0);
    const busy = starting || pendingStops > 0;
    const [failure, setFailure] = useState<string | null>(null);
    const [failureDetail, setFailureDetail] = useState<string | null>(null);
    const authority = useRef<CurveAuthority | null>(null);
    const observed = useRef<CurveSnapshot | null>(null);
    const revision = useRef(0);
    const startIntent = useRef<number | null>(null);
    const departureReason = useRef<CurveStopRequest['reason']>('view_hidden');
    const stopping = useRef(new Map<string, Promise<boolean>>());
    const snapshotRef = useRef(snapshot);
    const mounted = useRef(true);
    const view = useRef(input);
    const connectionClock = useRef(status?.sensor_clock);
    useEffect(() => {
        connectionClock.current = status?.sensor_clock;
    }, [status?.sensor_clock]);
    useEffect(() => {
        view.current = input;
    }, [input]);
    const acceptSnapshot = useCallback((curve: CurveSnapshot | null, time: number, clock: string | null) => {
        if (clock !== (connectionClock.current ?? null)) return false;
        const previous = snapshotRef.current;
        if (
            previous.clock === clock &&
            (time < previous.time ||
                (curve && previous.curve && curve.authority.generation < previous.curve.authority.generation))
        )
            return false;
        if (previous.clock === clock && previous.time === time && previous.curve === curve) return true;
        const next = { curve, time, clock };
        snapshotRef.current = next;
        observed.current = curve;
        if (!curve || !ownsHeater(curve) || (authority.current && !sameAuthority(authority.current, curve.authority)))
            authority.current = null;
        if (mounted.current) setSnapshot(next);
        return true;
    }, []);
    useEffect(() => {
        if (status?.server_time != null)
            acceptSnapshot(status.curve ?? null, status.server_time, status.sensor_clock ?? null);
    }, [status, acceptSnapshot]);

    const stopAuthority = useCallback(
        (ticket: CurveAuthority, reason: CurveStopRequest['reason']) => {
            const key = `${ticket.sensor_clock}:${ticket.run_id}:${ticket.generation}:${reason}`;
            const pending = stopping.current.get(key);
            if (pending !== undefined) return pending;
            if (sameAuthority(authority.current, ticket)) authority.current = null;
            if (mounted.current) setPendingStops((count) => count + 1);
            const relevant = () =>
                connectionClock.current === ticket.sensor_clock &&
                (!observed.current || sameAuthority(observed.current.authority, ticket));
            const operation = sidecar
                .pidOff({ mode: 'curve', authority: ticket, reason })
                .then((response) => {
                    const complete = response.curve.terminal_outcome === 'completed';
                    const accepted = acceptSnapshot(
                        response.curve,
                        response.server_time,
                        response.curve.authority.sensor_clock,
                    );
                    if (accepted && relevant()) {
                        if (mounted.current) setFailure(complete ? null : 'stop_unconfirmed');
                        if (!complete) useToastStore.getState().show(i18n.t('fsd.reasons.stop_unconfirmed'), 'error');
                    }
                    return complete;
                })
                .catch(() => {
                    if (relevant()) {
                        if (mounted.current) setFailure('stop_failed');
                        useToastStore.getState().show(i18n.t('fsd.reasons.stop_failed'), 'error');
                    }
                    return false;
                })
                .finally(() => {
                    stopping.current.delete(key);
                    if (mounted.current) setPendingStops((count) => count - 1);
                });
            stopping.current.set(key, operation);
            return operation;
        },
        [acceptSnapshot],
    );

    const stop = useCallback(
        (reason: CurveStopRequest['reason'] = 'user') => {
            revision.current += 1;
            if (
                reason === 'drop' ||
                (departureReason.current !== 'drop' &&
                    (reason === 'workspace_changed' || departureReason.current !== 'workspace_changed'))
            )
                departureReason.current = reason;
            const ticket = authority.current ?? observed.current?.authority;
            authority.current = null;
            return ticket ? stopAuthority(ticket, reason) : Promise.resolve(true);
        },
        [stopAuthority],
    );

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            void stop('view_hidden');
        };
    }, [stop]);
    useEffect(() => {
        const hide = () => {
            if (document.visibilityState !== 'visible') void stop('view_hidden');
        };
        document.addEventListener('visibilitychange', hide);
        return () => document.removeEventListener('visibilitychange', hide);
    }, [stop]);
    useEffect(() => {
        if (roastFinished) void stop('drop');
        else if (!input?.visible || !healthy) void stop('view_hidden');
    }, [input?.visible, healthy, roastFinished, stop]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: a retired acquisition clock cannot retain a lease
    useEffect(
        () => () => {
            void stop('view_hidden');
        },
        [status?.sensor_clock, stop],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: departure revokes this view's authority
    useEffect(
        () => () => {
            void stop('workspace_changed');
        },
        [input?.workspaceId, input?.sessionId, stop],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: changing the frozen source requires explicit rearm
    useEffect(
        () => () => {
            void stop('user');
        },
        [input?.reference, stop],
    );
    useEffect(() => {
        if (!input?.visible || !healthy || roastFinished) return;
        const renewing = new Set<string>();
        const timer = setInterval(() => {
            const ticket = authority.current;
            if (!ticket || renewing.has(ticket.run_id) || document.visibilityState !== 'visible') return;
            renewing.add(ticket.run_id);
            const intent = revision.current;
            void sidecar
                .pidRenew(ticket)
                .catch(() => {
                    if (revision.current !== intent || !sameAuthority(authority.current, ticket)) return;
                    if (mounted.current) setFailure('renew_failed');
                    void stop('view_hidden');
                })
                .finally(() => {
                    renewing.delete(ticket.run_id);
                });
        }, 1000);
        return () => clearInterval(timer);
    }, [input?.visible, healthy, roastFinished, stop]);

    const curve = snapshot.curve;
    const active = ownsHeater(curve);
    const charge = status?.charge;
    const source = input?.reference;
    const capability = status?.control?.pid?.curve;
    let reason: string | null = null;
    if (!input?.entitled) reason = 'entitlement';
    else if (!input.visible || !healthy) reason = 'view_unavailable';
    else if (!capability?.supported) reason = capability?.reason ?? 'unsupported';
    else if (input.referenceLoading) reason = 'loading';
    else if (!source) reason = input.referenceReason ?? 'no_profile';
    else if (!charge || charge.session_id !== input.sessionId || charge.charge_id !== input.acceptedCharge?.charge_id)
        reason = 'no_charge';
    else if (
        source.source_machine.machine_id !== charge.machine.machine_id ||
        source.source_machine.roaster_key !== charge.machine.roaster_key ||
        source.source_machine.protocol !== charge.machine.protocol
    )
        reason = 'machine_mismatch';
    else if (
        input.referenceTpTime != null &&
        (status?.server_time == null || status.server_time - charge.acquired_at < input.referenceTpTime)
    )
        reason = 'reference_tp_pending';
    else if (fixedActive) reason = 'fixed_active';
    else if (replayActive) reason = 'replay_active';
    else if (roastFinished) reason = 'charge_closed';
    else if (!status?.curve_eligibility?.eligible) reason = status?.curve_eligibility?.reason ?? 'no_charge';
    else if (active) reason = 'already_active';

    const start = useCallback(async () => {
        if (
            reason ||
            busy ||
            startIntent.current !== null ||
            !input?.reference ||
            !input.sessionId ||
            !charge ||
            !status?.heater_control ||
            !status.sensor_clock ||
            status.connection_epoch == null ||
            document.visibilityState !== 'visible'
        )
            return;
        const intent = ++revision.current;
        startIntent.current = intent;
        departureReason.current = 'view_hidden';
        setStarting(true);
        setFailure(null);
        setFailureDetail(null);
        try {
            const response = await sidecar.pidOn({
                mode: 'curve',
                session_id: input.sessionId,
                charge_id: charge.charge_id,
                request_id: crypto.randomUUID(),
                sensor_clock: status.sensor_clock,
                connection_epoch: status.connection_epoch,
                expected_generation: status.heater_control.generation,
                machine: charge.machine,
                config_id: 'virtual-v1',
                reference: input.reference,
            });
            if (
                intent !== revision.current ||
                !mounted.current ||
                !view.current?.visible ||
                document.visibilityState !== 'visible'
            ) {
                acceptSnapshot(response.curve, response.server_time, response.curve.authority.sensor_clock);
                await stopAuthority(response.curve.authority, departureReason.current);
                return;
            }
            acceptSnapshot(response.curve, response.server_time, response.curve.authority.sensor_clock);
            const current = snapshotRef.current.curve;
            if (current && sameAuthority(current.authority, response.curve.authority) && ownsHeater(current)) {
                authority.current = current.authority;
            }
        } catch (error) {
            if (mounted.current && revision.current === intent) {
                setFailure('start_failed');
                setFailureDetail(error instanceof Error ? error.message : null);
            }
        } finally {
            if (startIntent.current === intent) {
                startIntent.current = null;
                if (mounted.current) setStarting(false);
            }
        }
    }, [reason, busy, input, charge, status, acceptSnapshot, stopAuthority]);

    return {
        curve,
        active,
        busy,
        failure,
        failureDetail,
        reason,
        start,
        stop,
        available: input != null,
        receiptStatus: input?.receiptStatus,
    };
};
