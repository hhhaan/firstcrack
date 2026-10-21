import { useRoastingStore } from '@features/active-roast/model/status';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const RoastBatchTitle = () => {
    const { t } = useTranslation();
    const phase = useRoastingStore((state) => state.phase);
    const sessionId = useRoastingStore((state) => state.sessionId);
    const title = useRoastingStore((state) => state.activeSelection?.identity?.title ?? '');
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState(false);
    const dirty = useRef(false);
    if (phase !== 'roasting' || !sessionId) return null;
    return (
        <div className="mb-2 max-w-xl">
            <label htmlFor="running-batch-title" className="mb-1 block text-[11px] text-muted">
                {t('activeRoast.header.batchTitle')}
            </label>
            <input
                id="running-batch-title"
                aria-label={t('activeRoast.header.batchTitle')}
                aria-describedby="running-batch-title-help"
                value={editing ? draft : title}
                maxLength={120}
                onFocus={() => {
                    dirty.current = false;
                    setDraft(title);
                    setEditing(true);
                }}
                onChange={(event) => {
                    dirty.current = true;
                    setDraft(event.target.value);
                }}
                onBlur={() => {
                    if (dirty.current) useRoastingStore.getState().setRunningBatchTitle(sessionId, draft);
                    dirty.current = false;
                    setEditing(false);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                        dirty.current = false;
                        setDraft(title);
                        event.currentTarget.blur();
                    }
                }}
                className="w-full rounded border border-border-subtle bg-transparent px-2 py-1 text-xl text-primary outline-none focus:border-border"
            />
            <p id="running-batch-title-help" className="mt-1 text-[10px] text-muted">
                {t('activeRoast.header.batchTitleHint')}
            </p>
        </div>
    );
};
