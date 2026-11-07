import type { ControlCapability } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { useState } from 'react';
import { MACHINE_CONTROL_CHANNEL_ROLES } from '../lib/controlPanelShown';
import type { ControlCommand, ControlRole } from '../lib/controlSender';
import { isPercentUnit } from '../lib/snapPercent';
import { ChannelChip } from './ChannelChip';
import { HeaterScale } from './HeaterScale';
import { SetpointControl } from './SetpointControl';

/** Heater만 PID·Replay가 값을 잠근다. Fan·Drum은 그대로 둔다. */
function heaterHold(role: ControlRole, pidHoldsHeater: boolean, replayActive: boolean): 'PID' | 'Replay' | undefined {
    if (role !== 'heater') return undefined;
    if (pidHoldsHeater) return 'PID';
    if (replayActive) return 'Replay';
    return undefined;
}

/**
 * Manual setpoint layout. Percent heaters use the scale plus optional fan/drum chips.
 * Choosing a chip swaps that channel into the scale and leaves heater in the chip slot it left.
 * 0–10 faders keep the three-column row, with unsupported channels disabled.
 */
export const MachineControlChannels = ({
    limits,
    desired,
    liveData,
    writable,
    sending,
    pidHoldsHeater,
    replayActive,
    onChange,
    onCommit,
}: {
    limits: ControlCapability['limits'];
    desired: ControlCommand;
    liveData: { heater: number | null; fan: number | null; drum: number | null } | null;
    writable: boolean;
    sending: boolean;
    pidHoldsHeater: boolean;
    replayActive: boolean;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}) => {
    const lowerSlots = (['fan', 'drum'] as const).filter((role) => limits[role] != null);
    const [picked, setPicked] = useState<ControlRole>('heater');
    if (isPercentUnit(limits.heater?.unit)) {
        const scaleRole = picked !== 'heater' && limits[picked] != null ? picked : 'heater';
        const chipRoles = lowerSlots.map((role) => (role === scaleRole ? 'heater' : role));
        const scaleLimit = limits[scaleRole];
        const scaleHold = heaterHold(scaleRole, pidHoldsHeater, replayActive);
        return (
            <>
                <HeaterScale
                    key={scaleRole}
                    role={scaleRole}
                    limit={scaleLimit ?? {}}
                    value={scaleLimit != null ? desired[scaleRole] : undefined}
                    feedback={scaleLimit != null && liveData ? liveData[scaleRole] : null}
                    disabled={!writable || scaleLimit == null || scaleHold != null}
                    unsupported={scaleLimit == null}
                    sending={sending}
                    lockedNote={scaleLimit == null ? 'N/A' : scaleHold}
                    onChange={onChange}
                    onCommit={onCommit}
                />
                {chipRoles.length > 0 && (
                    <div className="flex shrink-0 flex-col gap-1.5">
                        {chipRoles.map((role) => {
                            const hold = heaterHold(role, pidHoldsHeater, replayActive);
                            return (
                                <ChannelChip
                                    key={role}
                                    role={role}
                                    limit={limits[role] ?? {}}
                                    value={desired[role]}
                                    feedback={liveData ? liveData[role] : null}
                                    disabled={!writable || hold != null}
                                    lockedNote={hold}
                                    onSelect={() => setPicked(role)}
                                    onChange={onChange}
                                    onCommit={onCommit}
                                />
                            );
                        })}
                    </div>
                )}
            </>
        );
    }
    return (
        <div className={cn('flex min-h-24 flex-1 justify-around gap-1', sending && 'opacity-40')}>
            {MACHINE_CONTROL_CHANNEL_ROLES.map((role) => {
                const supported = limits[role] != null;
                const hold = heaterHold(role, pidHoldsHeater, replayActive);
                return (
                    <SetpointControl
                        key={role}
                        role={role}
                        limit={limits[role] ?? {}}
                        value={supported ? desired[role] : undefined}
                        feedback={supported && liveData ? liveData[role] : null}
                        disabled={!writable || !supported || hold != null}
                        unsupported={!supported}
                        lockedNote={supported ? hold : 'N/A'}
                        onChange={onChange}
                        onCommit={onCommit}
                    />
                );
            })}
        </div>
    );
};
