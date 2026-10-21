import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

export const ControlSourceSettings = () => {
    const { t } = useTranslation();
    const { controlDataSource } = useRoastSettings();
    return (
        <SettingsSection group="general">
            <SettingsSection.Header
                title={t('activeRoast.controlSource.title')}
                description={t('activeRoast.controlSource.description')}
            />
            <SettingsSection.Body className="flex-row flex-wrap gap-4">
                {(['auto', 'manual', 'both'] as const).map((mode) => (
                    <SettingsCheckRow
                        key={mode}
                        type="radio"
                        name="controlDataSource"
                        checked={controlDataSource === mode}
                        label={t(`activeRoast.controlSource.${mode}`)}
                        onChange={() => updateRoastSettings({ controlDataSource: mode })}
                    />
                ))}
            </SettingsSection.Body>
        </SettingsSection>
    );
};
