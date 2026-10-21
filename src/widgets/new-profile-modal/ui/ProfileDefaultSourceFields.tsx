import type { ProfileSource } from '@entities/roast-profile';
import { labelCls } from '@shared/ui/form-styles';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export const ProfileDefaultSourceFields = ({
    beans,
    blends,
    sources,
    setSources,
}: {
    beans: { id: string; name: string }[];
    blends: { id: string; name: string }[];
    sources: ProfileSource[];
    setSources: (sources: ProfileSource[]) => void;
}) => {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const groups = [
        { kind: 'bean' as const, label: t('newProfileModal.singleOrigin'), items: beans },
        { kind: 'blend' as const, label: t('newProfileModal.blend'), items: blends },
    ];
    return (
        <fieldset className="border-t border-black/4 dark:border-border pt-6">
            <legend className={labelCls}>{t('newProfileModal.registeredSources')}</legend>
            <p className="text-xs text-muted mb-2">{t('newProfileModal.registeredSourcesHint')}</p>
            <input
                aria-label={t('newProfileModal.searchSources')}
                placeholder={t('newProfileModal.searchSources')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm bg-transparent mb-2"
            />
            <div className="max-h-52 overflow-y-auto space-y-3">
                {groups.map((group) => (
                    <div key={group.kind}>
                        <p className="text-xs text-muted mb-1">{group.label}</p>
                        {group.items
                            .filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
                            .map((item) => {
                                const checked = sources.some((s) =>
                                    group.kind === 'bean' ? s.bean_id === item.id : s.blend_id === item.id,
                                );
                                return (
                                    <label key={item.id} className="flex items-center gap-2 py-1 text-sm text-primary">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() =>
                                                setSources(
                                                    checked
                                                        ? sources.filter((s) =>
                                                              group.kind === 'bean'
                                                                  ? s.bean_id !== item.id
                                                                  : s.blend_id !== item.id,
                                                          )
                                                        : [
                                                              ...sources,
                                                              {
                                                                  bean_id: group.kind === 'bean' ? item.id : null,
                                                                  blend_id: group.kind === 'blend' ? item.id : null,
                                                              },
                                                          ],
                                                )
                                            }
                                        />
                                        {item.name}
                                    </label>
                                );
                            })}
                    </div>
                ))}
            </div>
        </fieldset>
    );
};
