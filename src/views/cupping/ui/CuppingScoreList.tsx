import { choiceValuesForScores, formSchemaOrSca, tallyChoiceFields, useCuppingScoresBySample } from '@entities/cupping';
import { formatDateShort } from '@shared/lib/format';
import { useTranslation } from 'react-i18next';

type CuppingScoreListProps = {
    sampleId: string;
    formSnapshot?: unknown;
};

export const CuppingScoreList = ({ sampleId, formSnapshot }: CuppingScoreListProps) => {
    const { t } = useTranslation();
    const { data: scores = [], isLoading, isError } = useCuppingScoresBySample(sampleId);
    const schema = formSchemaOrSca(formSnapshot);
    const tallies = tallyChoiceFields(
        schema,
        scores.map((row) => ({ scores: asScoreMap(row.scores) })),
    );

    if (isLoading) {
        return <p className="px-4 py-3 text-[12px] text-muted">{t('cupping.scoresLoading')}</p>;
    }

    if (isError) {
        return <p className="px-4 py-3 text-[12px] text-muted">{t('cupping.scoresLoadError')}</p>;
    }

    if (scores.length === 0) {
        return <p className="px-4 py-3 text-[12px] text-muted">{t('cupping.scoresEmpty')}</p>;
    }

    return (
        <div>
            {tallies.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                    {tallies.map((tally) => (
                        <span
                            key={tally.key}
                            className="rounded-sm bg-surface px-2 py-0.5 text-[11px] font-medium tracking-[0.14px] text-secondary dark:bg-[#2a2e31]"
                        >
                            {tally.label}
                            {tally.counts.map((c) => ` · ${c.value} ${c.count}`).join('')}
                        </span>
                    ))}
                </div>
            ) : null}
            <ul className="divide-y divide-border-subtle dark:divide-[#585d61]">
                {scores.map((row) => {
                    const tags = Array.isArray(row.descriptors) ? row.descriptors.filter(Boolean) : [];
                    const choices = choiceValuesForScores(schema, asScoreMap(row.scores));
                    return (
                        <li key={row.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <div className="min-w-0">
                                    <span className="text-[13px] font-medium text-primary">
                                        {row.cupped_by?.trim() || t('cupping.anonymous')}
                                    </span>
                                    <span className="ml-2 text-[11px] text-muted">
                                        {formatDateShort(row.cupped_at)}
                                    </span>
                                </div>
                                <span className="font-mono text-[14px] font-semibold tabular-nums text-primary">
                                    {Number(row.total_score).toFixed(2)}
                                </span>
                            </div>
                            {choices.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {choices.map((ch) => (
                                        <span
                                            key={`${ch.label}-${ch.value}`}
                                            className="rounded-sm bg-surface px-2 py-0.5 text-[11px] font-medium tracking-[0.14px] text-secondary dark:bg-[#2a2e31]"
                                        >
                                            {ch.label} · {ch.value}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {tags.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="rounded-sm bg-surface px-2 py-0.5 text-[11px] font-medium tracking-[0.14px] text-secondary dark:bg-[#2a2e31]"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {row.notes?.trim() ? (
                                <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-muted">{row.notes}</p>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

function asScoreMap(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
}
