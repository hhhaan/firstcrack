import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import type { BatchTitleNumbering } from '@shared/types/roast';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

const modes: BatchTitleNumbering[] = ['profile', 'total', 'none'];

export const BatchTitleSettings = () => {
    const { t } = useTranslation();
    const { batchTitleNumbering } = useRoastSettings();
    return (
        <SettingsSection group="general">
            <SettingsSection.Header
                title={t('activeRoast.batchTitleSettings.title')}
                description={t('activeRoast.batchTitleSettings.description')}
            />
            <SettingsSection.Body className="flex-row flex-wrap gap-4">
                {modes.map((mode) => (
                    <SettingsCheckRow
                        key={mode}
                        type="radio"
                        name="batchTitleNumbering"
                        checked={batchTitleNumbering === mode}
                        label={t(`activeRoast.batchTitleSettings.${mode}`)}
                        onChange={() => updateRoastSettings({ batchTitleNumbering: mode })}
                    />
                ))}
                {/* 접두어 입력은 숨김. 기본값은 PR. 복구 시 주석 해제.
                <label className="grid min-w-40 gap-1 text-xs text-secondary">
                    {t('activeRoast.batchTitleSettings.prefix')}
                    <input
                        name="totalBatchPrefix"
                        type="text"
                        maxLength={TOTAL_BATCH_PREFIX_MAX}
                        value={draft ?? totalBatchPrefix}
                        className="w-28 rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs text-primary outline-none focus:border-primary"
                        onChange={(event) => setDraft(event.currentTarget.value)}
                        onBlur={(event) => {
                            updateRoastSettings({
                                totalBatchPrefix: normalizeTotalBatchPrefix(event.currentTarget.value),
                            });
                            setDraft(null);
                        }}
                    />
                </label>
                */}
            </SettingsSection.Body>
        </SettingsSection>
    );
};
