import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReplayStopReason, useReplayControl } from '../model/useReplayControl';

interface Props {
    replay: ReturnType<typeof useReplayControl>;
    /** 표시 단위 — 내부 판정은 °C, 표시만 변환한다 */
    unit: 'C' | 'F';
}

// 'finished'는 배치 종료라 안내하지 않는다 — 맵에 없으면 렌더 생략
const STOP_REASON_KEYS: Partial<Record<ReplayStopReason, string>> = {
    disconnected: 'activeRoast.replay.stop.disconnected',
    pid: 'activeRoast.replay.stop.pid',
    unacknowledged: 'activeRoast.replay.stop.unacknowledged',
    unwritable: 'activeRoast.replay.stop.unwritable',
    manual: 'activeRoast.replay.stop.manual',
    profileChanged: 'activeRoast.replay.stop.profileChanged',
    controlDiverged: 'activeRoast.replay.stop.controlDiverged',
    timingGap: 'activeRoast.replay.stop.timingGap',
    writeFailed: 'activeRoast.replay.stop.writeFailed',
};

/**
 * Replay Assist 패널 (#300) — 레퍼런스 배치의 가스 조작을 BT 도달 시점에 재생.
 *
 * 항상 렌더한다 — 타겟 미선택·합성 프로파일 등으로 재생 불가면 체크박스만
 * disabled로 둔다. 숨겨버리면 "기능이 사라졌다"로 읽힌다. 기본 OFF.
 */
export const ReplayControlPanel = ({ replay, unit }: Props) => {
    const { t } = useTranslation();
    const stopKey = replay.stopReason ? STOP_REASON_KEYS[replay.stopReason] : undefined;
    const stopText = stopKey ? t(stopKey) : undefined;
    // disabled 사유 안내 — native title은 OS 지연(~1s)이 있어 CSS 툴팁으로 즉시 띄운다
    const disabledHint = replay.machineMismatch
        ? t('activeRoast.replay.disabled.machineMismatch')
        : !replay.available
          ? t('activeRoast.replay.disabled.noReference')
          : !replay.active && replay.blocked
            ? t('activeRoast.replay.disabled.blocked')
            : undefined;

    return (
        <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {t('activeRoast.replay.title')}
                </span>
                <span className={`text-[11px] font-medium ${replay.active ? 'text-emerald-500' : 'text-muted'}`}>
                    {replay.active ? t('activeRoast.replay.on') : t('activeRoast.replay.off')}
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
                <span className="text-[12px] text-secondary">{t('activeRoast.replay.enable')}</span>
                {disabledHint && (
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute top-full left-0 right-0 z-10 mt-1 hidden rounded-md border border-border-subtle bg-surface-elevated p-2 text-[11px] leading-snug text-secondary group-hover:block"
                    >
                        {disabledHint}
                    </span>
                )}
            </label>

            {!replay.active && stopText && <p className="text-[11px] leading-snug text-red-500">{stopText}</p>}

            {replay.active &&
                (replay.nextEvent ? (
                    <p className="font-mono text-[11px] text-muted">
                        {t('activeRoast.replay.next', {
                            temp: Math.round(unit === 'F' ? (replay.nextEvent.bt * 9) / 5 + 32 : replay.nextEvent.bt),
                            unit,
                            heater: Math.round(replay.nextEvent.heater),
                        })}
                    </p>
                ) : (
                    <p className="text-[11px] text-muted">{t('activeRoast.replay.done')}</p>
                ))}

            {/* 상세 안내는 hover 툴팁으로 — 재생 내내 문단 2개가 패널을 차지하면 안 된다 */}
            {replay.active && (
                <div className="group relative flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                    <Info size={12} strokeWidth={2} className="shrink-0" />
                    <span>{t('activeRoast.replay.slidersLocked')}</span>
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-0 right-0 z-10 mb-1 hidden rounded-md border border-border-subtle bg-surface-elevated p-2 leading-snug text-secondary group-hover:block"
                    >
                        {t('activeRoast.replay.slidersLockedHint')}
                    </span>
                </div>
            )}
        </div>
    );
};
