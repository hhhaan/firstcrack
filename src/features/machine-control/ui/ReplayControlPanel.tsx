import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isGiesenRoasterKey, resolveReplayDisableReason } from '../lib/replayStatus';
import type { useReplayControl } from '../model/useReplayControl';

interface Props {
    replay: ReturnType<typeof useReplayControl>;
    /** 표시 단위 — 내부 판정은 °C, 표시만 변환한다 */
    unit: 'C' | 'F';
    /** TSV 로드 실패 — 기록 없음과 카피를 접지 않는다 (#372). 페치는 #347 */
    curveError?: boolean;
    /** 현재 기기 키 — 기센 Manual 배너 게이트 */
    roasterKey?: string | null;
    dropBehavior: 'hold' | 'zero';
    onOpenRoastSettings?: () => void;
}

/**
 * Replay Assist 패널 (#300) — 레퍼런스 배치의 가스 조작을 BT 도달 시점에 재생.
 *
 * 항상 렌더한다 — 타겟 미선택·합성 프로파일 등으로 재생 불가면 체크박스만
 * disabled로 둔다. 숨겨버리면 "기능이 사라졌다"로 읽힌다. 기본 OFF.
 * 사유는 hover가 아니라 상시 표시 (#372).
 */
export const ReplayControlPanel = ({
    replay,
    unit,
    curveError = false,
    roasterKey = null,
    dropBehavior,
    onOpenRoastSettings,
}: Props) => {
    const { t } = useTranslation();
    const stopKey =
        replay.stopReason && replay.stopReason !== 'finished'
            ? (`activeRoast.replay.stop.${replay.stopReason}` as const)
            : undefined;
    const disableReason = resolveReplayDisableReason({
        active: replay.active,
        machineMismatch: replay.machineMismatch,
        hasPlan: replay.hasPlan,
        curveError,
        sidecarConnected: replay.sidecarConnected,
        heaterWritable: replay.heaterWritable,
        pidEngaged: replay.pidEngaged,
        heaterUnacknowledged: replay.heaterUnacknowledged,
    });
    const showGiesenBanner = isGiesenRoasterKey(roasterKey);

    return (
        <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {t('activeRoast.replay.title')}
                </span>
                <span className={`text-[11px] font-medium ${replay.active ? 'text-sky-500' : 'text-muted'}`}>
                    {replay.active ? t('activeRoast.replay.on') : t('activeRoast.replay.off')}
                </span>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={replay.active}
                    onChange={replay.toggle}
                    disabled={!replay.available || (!replay.active && replay.blocked)}
                    className="h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
                />
                <span className="text-[12px] text-secondary">{t('activeRoast.replay.enable')}</span>
            </label>

            {disableReason && (
                <p className="text-[11px] leading-snug text-secondary">
                    {t(`activeRoast.replay.disable.${disableReason}`)}
                </p>
            )}

            {showGiesenBanner && (
                <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-500">
                    {t('activeRoast.replay.giesenManual')}
                </p>
            )}

            {!replay.active && stopKey && <p className="text-[11px] leading-snug text-red-500">{t(stopKey)}</p>}

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

            {replay.active && (
                <div className="group relative flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                    <Info size={12} strokeWidth={2} className="shrink-0" />
                    <span>{t('activeRoast.replay.sliderLocked')}</span>
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-0 right-0 z-10 mb-1 hidden rounded-md border border-border-subtle bg-surface-elevated p-2 leading-snug text-secondary group-hover:block"
                    >
                        {t('activeRoast.replay.sliderLockedHint')}
                    </span>
                </div>
            )}

            <p className="text-[11px] leading-snug text-muted">
                {dropBehavior === 'zero' ? t('activeRoast.replay.dropZero') : t('activeRoast.replay.dropHold')}
                {onOpenRoastSettings && (
                    <>
                        {' · '}
                        <button
                            type="button"
                            onClick={onOpenRoastSettings}
                            className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-secondary underline-offset-2 hover:text-primary hover:underline"
                        >
                            {t('activeRoast.replay.dropSettings')}
                        </button>
                    </>
                )}
            </p>
        </div>
    );
};
