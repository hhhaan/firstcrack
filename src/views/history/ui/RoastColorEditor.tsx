import { useActiveWorkspace } from '@entities/organization';
import { useUpdateRoastSession } from '@entities/roast';
import { normalizeRoastColorText, ROAST_COLOR_MAX_LENGTH } from '@features/active-roast/lib/roastColorText';
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
    const [draft, setDraft] = useState(() => (stored != null ? stored : ''));
    const [tooLong, setTooLong] = useState(false);

    const commit = async () => {
        const next = normalizeRoastColorText(draft);
        if (draft.trim().length > ROAST_COLOR_MAX_LENGTH) {
            setTooLong(true);
            return;
        }
        setTooLong(false);
        if (next === (stored ?? null)) return;
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        try {
            await updateSession({ id: session.id, [column]: next });
        } catch {
            setDraft(stored != null ? stored : '');
        }
    };

    return (
        <div>
            <label
                htmlFor={`${testId}-${session.id}`}
                className="mb-1 block text-[11px] font-medium tracking-[0.3px] text-muted"
            >
                {t(labelKey)}
            </label>
            <input
                id={`${testId}-${session.id}`}
                data-testid={testId}
                type="text"
                value={draft}
                disabled={isPending}
                placeholder="—"
                aria-label={t(labelKey)}
                maxLength={ROAST_COLOR_MAX_LENGTH}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setTooLong(false);
                }}
                onBlur={() => void commit()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className={`w-full min-w-0 rounded-md border bg-main-bg px-2 py-1.5 font-mono text-[13px] font-medium tracking-[0.14px] text-primary outline-none ${
                    tooLong ? 'border-red-500' : 'border-border-subtle focus:border-border'
                }`}
            />
            {tooLong && <p className={formErrorCls}>{t('history.expanded.colorTooLong')}</p>}
        </div>
    );
};

/** History edit of whole-bean / ground color. Blur writes that column on the session. */
export const RoastColorEditor = ({ session }: { session: RoastSessionWithRelations }) => (
    <>
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
    </>
);
