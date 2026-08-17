import type { PidCapability, PidRuntime } from '@entities/machine';
import { usePidControl } from '../model/usePidControl';

const STATE_LABEL: Record<string, string> = {
    off: 'Off',
    running: 'Running',
    holding: 'Holding',
    fault: 'Fault',
};

const STATE_COLOR: Record<string, string> = {
    off: 'text-muted',
    running: 'text-emerald-500',
    holding: 'text-amber-500',
    fault: 'text-red-500',
};

interface Props {
    sidecarConnected: boolean;
    capability: PidCapability | undefined;
    runtime: PidRuntime | null;
    roastFinished: boolean;
    dropBehavior: 'hold' | 'zero';
}

/**
 * 소프트웨어 PID 패널 — 기본 OFF, 켜려면 명시적 조작이 필요하다.
 *
 * PID를 지원하지 않는 머신(게인이나 heater 쓰기 맵이 없는 경우)에서는 렌더하지 않는다.
 */
export const PidControlPanel = ({ sidecarConnected, capability, runtime, roastFinished, dropBehavior }: Props) => {
    const pid = usePidControl({ sidecarConnected, capability, runtime, roastFinished, dropBehavior });

    if (!pid.supported) return null;

    return (
        <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Auto Heat (PID)</span>
                <span className={`text-[11px] font-medium ${STATE_COLOR[pid.state] ?? 'text-muted'}`}>
                    {STATE_LABEL[pid.state] ?? pid.state}
                </span>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={pid.engaged}
                    disabled={pid.busy}
                    onChange={(e) => {
                        if (e.target.checked) void pid.turnOn();
                        else void pid.turnOff(dropBehavior);
                    }}
                    className="h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
                />
                <span className="text-[12px] text-secondary">Hold BT at target</span>
            </label>

            <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-medium text-secondary">Target</span>
                    <span className="font-mono text-[12px] text-primary">{Math.round(pid.sv)}°C</span>
                </div>
                <input
                    type="range"
                    min={pid.svMin}
                    max={pid.svMax}
                    step={1}
                    value={pid.sv}
                    aria-label="PID target temperature"
                    // 드래그 중에는 화면만 갱신하고, 손을 뗄 때 한 번만 머신에 보낸다
                    onChange={(e) => pid.previewSv(Number(e.target.value))}
                    onPointerUp={(e) => void pid.commitSv(Number(e.currentTarget.value))}
                    onKeyUp={(e) => void pid.commitSv(Number(e.currentTarget.value))}
                    className="w-full accent-[#111827] dark:accent-[#F2F2F2]"
                />
            </div>

            {pid.engaged && (
                <div className="flex justify-between font-mono text-[11px] text-muted">
                    <span>duty {pid.duty != null ? `${Math.round(pid.duty)}%` : '—'}</span>
                    <span>BT {pid.pv != null ? `${pid.pv.toFixed(1)}°C` : '—'}</span>
                </div>
            )}

            {/* fault는 토스트로 흘려보내지 않는다 — 화력이 멈춘 이유는 계속 보여야 한다 */}
            {pid.state === 'fault' && pid.error && <p className="text-[11px] leading-snug text-red-500">{pid.error}</p>}
        </div>
    );
};
