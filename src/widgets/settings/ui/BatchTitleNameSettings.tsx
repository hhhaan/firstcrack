import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

export const BatchTitleNameSettings = () => {
    const { t } = useTranslation();
    const { batchTitleSource } = useRoastSettings();
    return (
        <SettingsSection group="general">
            <SettingsSection.Header
                title={t('activeRoast.batchTitleSettings.nameSource.title')}
                description={t('activeRoast.batchTitleSettings.nameSource.description')}
            />
            <SettingsSection.Body className="flex-row flex-wrap gap-4">
                {(['profile', 'bean'] as const).map((source) => (
                    <SettingsCheckRow
                        key={source}
                        type="radio"
                        name="batchTitleSource"
                        checked={batchTitleSource === source}
                        label={t(`activeRoast.batchTitleSettings.nameSource.${source}`)}
                        onChange={() => updateRoastSettings({ batchTitleSource: source })}
                    />
                ))}
            </SettingsSection.Body>
        </SettingsSection>
    );
};
