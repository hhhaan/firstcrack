import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { formatSignedElapsed } from '@shared/lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoastEventMarker } from '../lib/chart-option';
import { formatRoastNote } from '../lib/roast-note';
import { formatTemp } from '../lib/temperature';
import type { TemperatureUnit } from '../model/settings';

/** A complete, scrollable alternative to canvas labels, including read-only reference notes. */
export const ChartEventDetails = ({ markers, unit }: { markers: RoastEventMarker[]; unit: TemperatureUnit }) => {
    const { t } = useTranslation();
    const entries = markers.filter((marker) => ['Note', 'Heater', 'Fan', 'Drum'].includes(marker.event));
    if (entries.length === 0) return null;
    return (
        <div className="absolute top-1 right-1 z-10" onPointerDown={(event) => event.stopPropagation()}>
            <Popover>
                <PopoverTrigger asChild>
                    <SurfaceButton icon={<List size={14} />}>{t('activeRoast.eventDetails')}</SurfaceButton>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    collisionPadding={12}
                    aria-label={t('activeRoast.eventDetails')}
                    className="w-80 max-w-[calc(100vw-24px)] p-3"
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <div
                        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll all event details.
                        tabIndex={0}
                        role="group"
                        aria-label={t('activeRoast.eventDetails')}
                        className="visible-scrollbar max-h-[min(60vh,400px,calc(var(--radix-popover-content-available-height)-24px))] overflow-y-auto overscroll-contain rounded focus-visible:outline-2 focus-visible:outline-primary"
                    >
                        {[...entries]
                            .sort((a, b) => a.timeSec - b.timeSec)
                            .map((marker, index) => (
                                <article
                                    key={`${marker.reference ? 'reference' : 'current'}-${marker.logId ?? index}`}
                                    className="border-b border-border-subtle py-2 last:border-b-0"
                                >
                                    <p className="m-0 flex flex-wrap gap-x-2 text-xs text-secondary">
                                        <span>{roastEventLabel(marker.event)}</span>
                                        <span className="font-mono">{formatSignedElapsed(marker.timeSec)}</span>
                                        <span>
                                            {marker.tempC != null ? formatTemp(marker.tempC, unit) : marker.temp}
                                        </span>
                                        {marker.reference && <span>{t('activeRoast.log.reference')}</span>}
                                    </p>
                                    <p className="m-0 mt-1 whitespace-pre-wrap wrap-anywhere text-[13px] text-primary">
                                        {marker.event === 'Note' ? formatRoastNote(marker, '\n') : marker.note}
                                    </p>
                                </article>
                            ))}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
};
