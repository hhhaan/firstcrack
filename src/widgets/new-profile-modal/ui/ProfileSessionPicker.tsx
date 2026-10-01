import { formatTemp, useRoastSettings } from '@features/active-roast';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { formatDuration } from '@shared/lib/format';
import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import type { Json } from '@shared/types/database.types';
import { modalCancelBtnCls, modalFooterChrome, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '../lib/format';

type SessionOption = {
    id: string;
    beans?: { name?: string | null } | null;
    roasted_at: string | null;
    drop_temp_celsius: number | null;
    duration_seconds: number | null;
    roast_level: string | null;
    events: Json | null;
};

type ProfileSessionPickerProps = {
    sessions: SessionOption[];
    onSelect: (sessionId: string) => void;
    onClose: () => void;
};

/** Locale names for FC Start and Drop. Without FC Start the profile has no dev time. */
const marksLabel = (events: Json | null): string | null => {
    const types = new Set(parseStoredRoastEvents(events).map((e) => e.type));
    const marks = [
        types.has('FC Start') ? roastEventLabel('FC Start') : null,
        types.has('Drop') ? roastEventLabel('Drop') : null,
    ].filter(Boolean);
    return marks.length > 0 ? marks.join(' · ') : null;
};

export const ProfileSessionPicker = ({ sessions, onSelect, onClose }: ProfileSessionPickerProps) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="new-profile-modal-title"
                    title={t('newProfileModal.selectSession')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-4"
                />
            </div>

            <div className="px-8 py-6 overflow-y-auto flex-1">
                {sessions.length === 0 ? (
                    <p className="text-sm text-muted text-center py-8">{t('newProfileModal.noSessions')}</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {sessions.map((session) => {
                            const marks = marksLabel(session.events);
                            const roastDurationSec = sessionRoastMetrics(session).roastDurationSec;
                            return (
                                <button
                                    key={session.id}
                                    type="button"
                                    onClick={() => onSelect(session.id)}
                                    className="w-full px-4 py-3 rounded-xl border border-black/6 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-left cursor-pointer hover:bg-white/90 dark:hover:bg-[#262b31] transition-all duration-200 group"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <span className="text-sm font-semibold text-primary">
                                                {session.beans?.name ?? t('newProfileModal.unknownBean')}
                                            </span>
                                            <span className="text-[12px] text-muted">
                                                {fmtDate(session.roasted_at)}
                                                {session.drop_temp_celsius != null &&
                                                    ` · ${t('newProfileModal.drop')} ${formatTemp(session.drop_temp_celsius, unit)}`}
                                                {roastDurationSec != null && ` · ${formatDuration(roastDurationSec)}`}
                                                {session.roast_level && ` · ${session.roast_level}`}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {marks ? (
                                                <span className="text-[10px] font-semibold tracking-[0.04em] px-1.5 py-0.5 rounded bg-palette-blue text-white">
                                                    {marks}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-semibold tracking-[0.04em] px-1.5 py-0.5 rounded border border-border text-muted">
                                                    {t('newProfileModal.noMarks')}
                                                </span>
                                            )}
                                            <ChevronRight
                                                size={16}
                                                strokeWidth={2}
                                                className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                                            />
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className={modalFooterChrome}>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('newProfileModal.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
};
