import { AccountSettingsTab } from '@widgets/settings/ui/AccountSettingsTab';
import { BillingSettingsTab } from '@widgets/settings/ui/BillingSettingsTab';
import { FeedbackSettingsTab } from '@widgets/settings/ui/FeedbackSettingsTab';
import { GeneralSettingsTab } from '@widgets/settings/ui/GeneralSettingsTab';
import { RoastSettingsTab } from '@widgets/settings/ui/RoastSettingsTab';
import { SettingsLayout } from '@widgets/settings/ui/SettingsLayout';
import type { SettingsNavigationProps } from '@widgets/settings/ui/SettingsSidebar';
import { SoftwareSettingsTab } from '@widgets/settings/ui/SoftwareSettingsTab';
import { TeamSettingsTab } from '@widgets/settings/ui/TeamSettingsTab';
import type { RoastSettingsGroup } from '@widgets/settings/ui/tabConfig';

export function Settings({
    activeTab,
    onTabChange,
    onClose,
    initialRoastGroup = null,
}: SettingsNavigationProps & { initialRoastGroup?: RoastSettingsGroup | null }) {
    return (
        <SettingsLayout
            activeTab={activeTab}
            onTabChange={onTabChange}
            onClose={onClose}
            initialRoastGroup={initialRoastGroup}
        >
            {activeTab === 'general' && <GeneralSettingsTab />}
            {activeTab === 'roast' && <RoastSettingsTab />}
            {activeTab === 'team' && <TeamSettingsTab />}
            {activeTab === 'account' && <AccountSettingsTab onClose={onClose} />}
            {activeTab === 'billing' && <BillingSettingsTab />}
            {activeTab === 'software' && <SoftwareSettingsTab />}
            {activeTab === 'feedback' && <FeedbackSettingsTab />}
        </SettingsLayout>
    );
}
