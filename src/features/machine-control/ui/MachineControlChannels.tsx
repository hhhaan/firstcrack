import type { ControlCapability } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import type { ControlCommand, ControlRole } from '../lib/controlSender';
import { isPercentUnit } from '../lib/snapPercent';
import { ChannelChip } from './ChannelChip';
import { HeaterScale } from './HeaterScale';
import { SetpointControl } from './SetpointControl';

/** Display order of the manual channels. Send order lives in the control sender. */
export const MACHINE_CONTROL_CHANNEL_ROLES: ControlRole[] = ['heater', 'fan', 'drum'];

/**
 * Manual setpoint layout. Percent heaters use the scale plus optional fan/drum chips.
 * 0–10 faders keep the three-column row, with unsupported channels disabled.
 */
export const MachineControlChannels = ({
    limits,
    desired,
    liveData,
    unacknowledged,
    writable,
    sending,
    pidHoldsHeater,
    replayActive,
    onChange,
    onCommit,
}: {
    limits: ControlCapability['limits'];
    desired: ControlCommand;
    liveData: { heater: number | null; fan: number; drum: number } | null;
    unacknowledged: Set<ControlRole>;
    writable: boolean;
    sending: boolean;
    pidHoldsHeater: boolean;
    replayActive: boolean;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}) => {
    const chipRoles = (['fan', 'drum'] as const).filter((role) => limits[role] != null);
    if (isPercentUnit(limits.heater?.unit)) {
        return (
            <>
                <HeaterScale
                    limit={limits.heater ?? {}}
                    value={limits.heater != null ? desired.heater : undefined}
                    feedback={limits.heater != null && liveData ? liveData.heater : null}
                    unacknowledged={limits.heater != null && unacknowledged.has('heater')}
                    disabled={!writable || limits.heater == null || pidHoldsHeater || replayActive}
                    unsupported={limits.heater == null}
                    sending={sending}
                    lockedNote={
                        limits.heater == null ? 'N/A' : pidHoldsHeater ? 'PID' : replayActive ? 'Replay' : undefined
                    }
                    onChange={onChange}
                    onCommit={onCommit}
                />
                {chipRoles.length > 0 && (
                    <div className="flex shrink-0 flex-col gap-1.5">
                        {chipRoles.map((role) => (
                            <ChannelChip
                                key={role}
                                role={role}
                                limit={limits[role] ?? {}}
                                value={desired[role]}
                                feedback={liveData ? liveData[role] : null}
                                unacknowledged={unacknowledged.has(role)}
                                disabled={!writable}
                                onChange={onChange}
                                onCommit={onCommit}
                            />
                        ))}
                    </div>
                )}
            </>
        );
    }
    return (
        <div className={cn('flex min-h-24 flex-1 justify-around gap-1', sending && 'opacity-40')}>
            {MACHINE_CONTROL_CHANNEL_ROLES.map((role) => {
                const supported = limits[role] != null;
                const lockedByPid = role === 'heater' && pidHoldsHeater;
                // Replay 재생 중 화력 소유권은 Replay에 있다 — 수동 조절은 체크 해제 후.
                // (fan/drum은 Replay가 안 만지므로 열어둔다)
                const lockedByReplay = role === 'heater' && replayActive;
                return (
                    <SetpointControl
                        key={role}
                        role={role}
                        limit={limits[role] ?? {}}
                        value={supported ? desired[role] : undefined}
                        feedback={supported && liveData ? liveData[role] : null}
                        unacknowledged={supported && unacknowledged.has(role)}
                        disabled={!writable || !supported || lockedByPid || lockedByReplay}
                        unsupported={!supported}
                        lockedNote={!supported ? 'N/A' : lockedByPid ? 'PID' : lockedByReplay ? 'Replay' : undefined}
                        onChange={onChange}
                        onCommit={onCommit}
                    />
                );
            })}
        </div>
    );
};
