import { useActiveWorkspace } from '@entities/organization';
import { useUpdateRoastSession } from '@entities/roast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { formErrorCls } from '@shared/ui/form-styles';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type ColorColumn = 'color_whole' | 'color_ground';

const parseColor = (raw: string): number | null | undefined => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const next = Number(trimmed);
    if (!Number.isFinite(next) || next < 0) return undefined;
    return next;
};

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
    const [draft, setDraft] = useState(() => (stored != null ? String(stored) : ''));
    const [invalid, setInvalid] = useState(false);

    const commit = async () => {
        const next = parseColor(draft);
        if (next === undefined) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        if (next === (stored ?? null)) return;
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        try {
            await updateSession({ id: session.id, [column]: next });
        } catch {
            setDraft(stored != null ? String(stored) : '');
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
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                value={draft}
                disabled={isPending}
                placeholder="—"
                aria-label={t(labelKey)}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setInvalid(false);
                }}
                onBlur={() => void commit()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className={`w-24 rounded-md border bg-main-bg px-2 py-1.5 font-mono text-[13px] font-medium tracking-[0.14px] text-primary outline-none ${
                    invalid ? 'border-red-500' : 'border-border-subtle focus:border-border'
                }`}
            />
            {invalid && <p className={formErrorCls}>{t('history.expanded.colorInvalid')}</p>}
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
