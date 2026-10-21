import { useActiveWorkspace } from '@entities/organization';
import { useUpdateRoastSession } from '@entities/roast';
import {
    isRoastColorTooLong,
    normalizeRoastColorText,
    parseRoastColorReadings,
    ROAST_COLOR_INPUT_MAX_LENGTH,
    roastColorAverage,
} from '@features/active-roast/lib/roastColorText';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { formErrorCls } from '@shared/ui/form-styles';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type ColorColumn = 'color_whole' | 'color_ground';

const ColorField = ({
    session,
    column,
    labelKey,
    testId,
}: {
    session: RoastSessionWithRelations;
    column: ColorColumn;
    labelKey: 'history.expanded.colorWhole' | 'history.expanded.colorGround';
    testId: string;
}) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync: updateSession, isPending } = useUpdateRoastSession(workspaceOwnerId);
    const stored = session[column];
    const [draft, setDraft] = useState(() => stored ?? '');
    const [tooLong, setTooLong] = useState(false);
    const [invalidNumbers, setInvalidNumbers] = useState(false);
    const average = roastColorAverage(draft);
    const readings = parseRoastColorReadings(draft);

    const commit = async () => {
        const next = normalizeRoastColorText(draft);
        if (next === (stored ?? null)) return;
        if (isRoastColorTooLong(draft)) {
            setTooLong(true);
            return;
        }
        setTooLong(false);
        if (readings == null) {
            setInvalidNumbers(true);
            return;
        }
        setInvalidNumbers(false);
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        try {
            await updateSession({ id: session.id, [column]: next });
        } catch {
            setDraft(stored ?? '');
        }
    };

    return (
        <div>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <label
                    htmlFor={`${testId}-${session.id}`}
                    className="text-[11px] font-medium tracking-[0.3px] text-muted"
                >
                    {t(labelKey)}
                </label>
                <span
                    id={`${testId}-${session.id}-average`}
                    data-testid={`${testId}-average`}
                    className="min-w-0 break-words text-[11px] font-medium text-secondary"
                    aria-live="polite"
                >
                    {average != null &&
                        t('history.expanded.colorAverage', { value: average.toFixed(2), count: readings?.length })}
                </span>
            </div>
            <input
                id={`${testId}-${session.id}`}
                data-testid={testId}
                type="text"
                inputMode="decimal"
                value={draft}
                disabled={isPending}
                placeholder="58.4, 59.1"
                aria-label={t(labelKey)}
                maxLength={ROAST_COLOR_INPUT_MAX_LENGTH}
                aria-invalid={tooLong || invalidNumbers}
                aria-describedby={`history-color-${session.id}-hint ${testId}-${session.id}-average ${testId}-${session.id}-help`}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setTooLong(false);
                    setInvalidNumbers(false);
                }}
                onBlur={() => void commit()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className={`w-full min-w-0 rounded-md border bg-main-bg px-2 py-1.5 font-mono text-[13px] font-medium tracking-[0.14px] text-primary outline-none focus-visible:ring-2 focus-visible:ring-strong-border/40 ${
                    tooLong || invalidNumbers ? 'border-red-500' : 'border-border-subtle focus:border-strong-border'
                }`}
            />
            <div id={`${testId}-${session.id}-help`} aria-live="polite">
                {tooLong && <p className={formErrorCls}>{t('history.expanded.colorTooLong')}</p>}
                {invalidNumbers && <p className={formErrorCls}>{t('history.expanded.colorInvalidNumbers')}</p>}
            </div>
        </div>
    );
};

/** History edit of whole-bean / ground color. Blur writes that column on the session. */
export const RoastColorEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();

    return (
        <div className="space-y-2">
            <ColorField
                session={session}
                column="color_whole"
                labelKey="history.expanded.colorWhole"
                testId="history-color-whole"
            />
            <ColorField
                session={session}
                column="color_ground"
                labelKey="history.expanded.colorGround"
                testId="history-color-ground"
            />
            <p id={`history-color-${session.id}-hint`} className="text-[11px] text-muted">
                {t('history.expanded.colorReadingsHint')}
            </p>
        </div>
    );
};
