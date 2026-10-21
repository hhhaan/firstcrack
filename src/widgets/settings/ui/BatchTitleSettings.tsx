import type { BatchTitleNumbering } from '@features/active-roast/lib/batch-title';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

const modes: BatchTitleNumbering[] = ['profile', 'total', 'both', 'none'];

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
            </SettingsSection.Body>
        </SettingsSection>
    );
};
