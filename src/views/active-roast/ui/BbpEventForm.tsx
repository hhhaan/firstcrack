import { useBbpStore } from '@features/active-roast/model/bbp';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const BbpEventFields = ({ rawBT }: { rawBT: number | null }) => {
    const { t } = useTranslation();
    const active = useBbpStore((state) => state.active && state.recording);
    const [gas, setGas] = useState('');
    const [airflow, setAirflow] = useState('');
    const [drum, setDrum] = useState('');
    const [note, setNote] = useState('');
    if (!active) return null;
    return (
        <form
            className="my-2 space-y-2 border-t border-border-subtle pt-3"
            onSubmit={(event) => {
                event.preventDefault();
                const state = useBbpStore.getState();
                const recorded = state.recordEvent({
                    t: Math.max(0, (Date.now() - state.startMs) / 1000),
                    tempC: rawBT,
                    event: 'Note',
                    note: note.trim(),
                    ...(gas && { gas }),
                    ...(airflow && { airflow }),
                    ...(drum && { drum }),
                });
                if (recorded) {
                    setGas('');
                    setAirflow('');
                    setDrum('');
                    setNote('');
                }
            }}
        >
            <h3 className="text-xs font-medium text-secondary">{t('activeRoast.bbpInput.title')}</h3>
            {[
                { key: 'gas', value: gas, set: setGas },
                { key: 'airflow', value: airflow, set: setAirflow },
                { key: 'drum', value: drum, set: setDrum },
            ].map((field) => (
                <label key={field.key} className="block text-[10px] text-muted">
                    {t(`activeRoast.bbpInput.${field.key}`)}
                    <input
                        type="number"
                        step="any"
                        value={field.value}
                        onChange={(event) => field.set(event.target.value)}
                        className="mt-0.5 w-full rounded border border-border bg-transparent px-2 py-1 text-xs text-primary"
                    />
                </label>
            ))}
            <label className="block text-[10px] text-muted">
                {t('activeRoast.bbpInput.note')}
                <input
                    maxLength={120}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="mt-0.5 w-full rounded border border-border bg-transparent px-2 py-1 text-xs text-primary"
                />
            </label>
            <button
                type="submit"
                disabled={!gas && !airflow && !drum && !note.trim()}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-primary disabled:opacity-40"
            >
                {t('activeRoast.bbpInput.add')}
            </button>
        </form>
    );
};

export const BbpEventForm = ({ rawBT }: { rawBT: number | null }) => {
    const generation = useBbpStore((state) => state.liveGeneration);
    return <BbpEventFields key={generation} rawBT={rawBT} />;
};
