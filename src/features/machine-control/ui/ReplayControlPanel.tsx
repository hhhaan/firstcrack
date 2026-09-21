import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatReplayCondition, formatReplayHeater } from '../lib/replayDisplay';
import { collapsedReplayTpChrome, isReplayTpHold, resolveReplayTpWait } from '../lib/replayStatus';
import type { ReplayStopReason, useReplayControl } from '../model/useReplayControl';

interface Props {
    replay: ReturnType<typeof useReplayControl>;
    /** 표시 단위 — 내부 판정은 °C, 표시만 변환한다 */
    unit: 'C' | 'F';
    /** 기기 native 화력 단위. 없으면 % */
    heaterUnit?: string;
}

export const REPLAY_OBSERVATION_HOLD_TEXT = '온도 데이터 확인 대기';

const replayStatus = (active: boolean, observationHold: boolean) => {
    if (observationHold) return { label: '대기', className: 'text-amber-600 dark:text-amber-500' };
    if (active) return { label: 'On', className: 'text-emerald-500' };
    return { label: 'Off', className: 'text-muted' };
};

// 'finished'는 배치 종료라 안내하지 않는다 — 맵에 없으면 렌더 생략
const STOP_REASON_TEXT: Partial<Record<ReplayStopReason, string>> = {
    disconnected: '연결 끊김으로 재생 중지',
    pid: 'PID 개입으로 재생 중지',
    unacknowledged: '명령 미반영으로 재생 중지',
    unwritable: '히터 제어 불가로 재생 중지',
    manual: '수동 조작으로 재생 중지',
    profileChanged: '프로파일 변경으로 재생 중지',
    controlDiverged: '화력이 재생 지시에서 벗어나 재생 중지',
    timingGap: '화면이 멈췄던 동안 재생 중지 — 현재 화력을 확인하세요',
    writeFailed: '화력 명령 전송 실패로 재생 중지 — 현재 화력을 확인하세요',
    observationStale: '온도 데이터가 끊겨 재생 중지 — 현재 화력을 확인하세요',
};

/**
 * Replay Assist 패널 (#300) — 레퍼런스 배치의 가스 조작을 BT 도달 시점에 재생.
 *
 * 항상 렌더한다 — 타겟 미선택·합성 프로파일 등으로 재생 불가면 체크박스만
 * disabled로 둔다. 숨겨버리면 "기능이 사라졌다"로 읽힌다. 기본 OFF.
 */
export const ReplayControlPanel = ({ replay, unit, heaterUnit }: Props) => {
    const { t } = useTranslation();
    const stopText = replay.stopReason ? STOP_REASON_TEXT[replay.stopReason] : undefined;
    const tpWait = resolveReplayTpWait({
        active: replay.active,
        nextEvent: replay.nextEvent,
        tpTime: replay.tpTime,
        confirmedTurningPoint: replay.confirmedTurningPoint,
    });
    const chrome = collapsedReplayTpChrome(replay.active, tpWait);
    const observationHold = replay.observationHold;
    const holding = isReplayTpHold(chrome) || observationHold;
    let statusClass = 'text-muted';
    if (holding) statusClass = 'text-amber-600 dark:text-amber-500';
    else if (chrome === 'running') statusClass = 'text-emerald-500';
    const statusLabel = observationHold ? replayStatus(true, true).label : replay.active ? 'On' : 'Off';
    const statusAttr = observationHold ? 'observation-hold' : (chrome ?? 'off');
    // disabled 사유 안내 — native title은 OS 지연(~1s)이 있어 CSS 툴팁으로 즉시 띄운다
    const disabledHint = replay.machineMismatch
        ? '다른 기기에서 기록된 프로파일은 재생할 수 없습니다 — 이 기기로 기록한 프로파일을 선택하세요'
        : replay.referenceLoading
          ? undefined
          : replay.missingHeatSet
            ? t('activeRoast.replay.missingHeatSet')
            : !replay.available
              ? t('activeRoast.replay.invalidPlan')
              : !replay.active && replay.blocked
                ? '지금은 켤 수 없습니다 — PID 해제·연결 상태를 확인하세요'
                : undefined;

    return (
        <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Replay</span>
                <span data-replay-status={statusAttr} className={`text-[11px] font-medium ${statusClass}`}>
                    {statusLabel}
                </span>
            </div>

            <label className="group relative flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={replay.active}
                    onChange={replay.toggle}
                    disabled={!replay.available || (!replay.active && replay.blocked)}
                    className="h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
                />
                <span className="text-[12px] text-secondary">레퍼런스 화력 재생</span>
                {disabledHint && (
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute top-full left-0 right-0 z-10 mt-1 hidden rounded-md border border-border-subtle bg-surface-elevated p-2 text-[11px] leading-snug text-secondary group-hover:block"
                    >
                        {disabledHint}
                    </span>
                )}
            </label>

            <p className="text-[11px] leading-snug text-secondary">{t('activeRoast.replay.syncOnStart')}</p>

            {!replay.active && stopText && <p className="text-[11px] leading-snug text-red-500">{stopText}</p>}
            {!replay.active && !stopText && replay.missingHeatSet && (
                <p className="text-[11px] leading-snug text-secondary">{t('activeRoast.replay.missingHeatSet')}</p>
            )}

            {replay.active && observationHold && (
                <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-500">
                    {REPLAY_OBSERVATION_HOLD_TEXT}
                </p>
            )}
            {replay.active && !observationHold && isReplayTpHold(chrome) && (
                <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-500">
                    {t(`activeRoast.replay.tp.${chrome}`)}
                </p>
            )}
            {chrome === 'running' &&
                !observationHold &&
                (replay.nextEvent && replay.nextEventTrigger ? (
                    <p className="font-mono text-[11px] text-muted">
                        {t('activeRoast.replay.next', {
                            condition: formatReplayCondition(replay.nextEvent, replay.nextEventTrigger, unit),
                            heater: formatReplayHeater(replay.nextEvent.heater, heaterUnit),
                        })}
                    </p>
                ) : (
                    <p className="text-[11px] text-muted">{t('activeRoast.replay.done')}</p>
                ))}

            {/* 상세 안내는 hover 툴팁으로 — 재생 내내 문단 2개가 패널을 차지하면 안 된다 */}
            {replay.active && (
                <div className="group relative flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                    <Info size={12} strokeWidth={2} className="shrink-0" />
                    <span>슬라이더 잠김</span>
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-0 right-0 z-10 mb-1 hidden rounded-md border border-border-subtle bg-surface-elevated p-2 leading-snug text-secondary group-hover:block"
                    >
                        재생 중에는 자리를 비우지 마세요 — 화력이 재생 지시에서 계속 벗어나면 자동 중지됩니다. 수동
                        조절은 체크 해제 후 하세요. 기센은 본체 Auto를 Manual로 두어야 합니다.
                    </span>
                </div>
            )}
        </div>
    );
};
