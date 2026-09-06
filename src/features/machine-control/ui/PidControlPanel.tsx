import { useTranslation } from 'react-i18next';
import type { usePidControl } from '../model/usePidControl';

const STATE_COLOR: Record<string, string> = {
    off: 'text-muted',
    running: 'text-emerald-500',
    holding: 'text-amber-500',
    fault: 'text-red-500',
};

interface Props {
    /** 부모(MachineControlPanel)가 소유한 PID 상태 — 훅을 여기서 부르면 패널이
     * 숨겨질 때 DROP 자동 해제 effect까지 언마운트된다(#269). */
    pid: ReturnType<typeof usePidControl>;
    dropBehavior: 'hold' | 'zero';
    /** Replay가 히터를 잡고 있는 동안 PID 켜기 차단 — 히터 소유권은 하나 (#300) */
    replayActive: boolean;
}

/**
 * 소프트웨어 PID 패널 — 기본 OFF, 켜려면 명시적 조작이 필요하다.
 *
 * PID를 지원하지 않는 머신(게인이나 heater 쓰기 맵이 없는 경우)에서는 렌더하지 않는다.
 */
export const PidControlPanel = ({ pid, dropBehavior, replayActive }: Props) => {
    const { t } = useTranslation();
    if (!pid.supported) return null;

    const stateKey = `machineControl.pid.${pid.state}`;
    const stateLabel = t(stateKey, { defaultValue: pid.state });

    return (
        <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {t('machineControl.pid.title')}
                </span>
                <span className={`text-[11px] font-medium ${STATE_COLOR[pid.state] ?? 'text-muted'}`}>
                    {stateLabel}
                </span>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={pid.engaged}
                    // Replay 중 켜기 차단 — 끄기는 engaged일 때만 의미 있고 그때 Replay는 이미 죽어 있다
                    disabled={pid.busy || (!pid.engaged && replayActive)}
                    onChange={(e) => {
                        if (e.target.checked) void pid.turnOn();
                        else void pid.turnOff(dropBehavior);
                    }}
                    className="h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
                />
                <span className="text-[12px] text-secondary">{t('machineControl.pid.holdBt')}</span>
            </label>

            <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-medium text-secondary">{t('machineControl.pid.target')}</span>
                    <span className="font-mono text-[12px] text-primary">{Math.round(pid.sv)}°C</span>
                </div>
                <input
                    type="range"
                    min={pid.svMin}
                    max={pid.svMax}
                    step={1}
                    value={pid.sv}
                    aria-label={t('machineControl.pid.targetAria')}
                    // 드래그 중에는 화면만 갱신하고, 손을 뗄 때 한 번만 머신에 보낸다
                    onChange={(e) => pid.previewSv(Number(e.target.value))}
                    onPointerUp={(e) => void pid.commitSv(Number(e.currentTarget.value))}
                    // 드래그 취소·포커스 이탈·AT 입력에서도 마지막 값이 나가야 한다 (#269)
                    onPointerCancel={(e) => void pid.commitSv(Number(e.currentTarget.value))}
                    onBlur={(e) => void pid.commitSv(Number(e.currentTarget.value))}
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
