import { logger } from '@shared/lib/logger';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow, settingsOptionLabelCls } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

const SUPPORT_EMAIL = 'support@firstcrackiscoming.com';
const WEBSITE_URL = 'https://firstcrackiscoming.com';

const actionBtnCls =
    'flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-border bg-white dark:bg-[#262B31] text-[13px] font-medium text-[#111827] dark:text-primary hover:bg-[#F9FAFB] dark:hover:bg-[#181d21] active:opacity-90 transition-all cursor-pointer';

async function openExternal(url: string, context: string) {
    try {
        await openUrl(url);
    } catch (e) {
        logger.capture(e, { context });
    }
}

export function FeedbackSettingsTab() {
    const { t } = useTranslation();

    return (
        <div className="grid gap-8">
            <SettingsSection>
                <SettingsSection.Header
                    icon={<Mail size={16} strokeWidth={1.8} />}
                    title={t('settings.tabs.feedback.contactTitle')}
                    description={t('settings.tabs.feedback.contactDescription')}
                />
                <SettingsSection.Body className="flex flex-col gap-3">
                    <SettingsOptionRow tone="muted">
                        <span className={settingsOptionLabelCls}>{SUPPORT_EMAIL}</span>
                    </SettingsOptionRow>
                    <button
                        type="button"
                        onClick={() => void openExternal(`mailto:${SUPPORT_EMAIL}`, 'feedback open email')}
                        className={actionBtnCls}
                    >
                        <Mail size={14} strokeWidth={2} />
                        {t('settings.tabs.feedback.contactAction')}
                        <ExternalLink size={13} strokeWidth={2} className="text-[#9CA3AF] dark:text-[#666] ml-auto" />
                    </button>
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection>
                <SettingsSection.Header
                    icon={<ExternalLink size={16} strokeWidth={1.8} />}
                    title={t('settings.tabs.feedback.websiteTitle')}
                    description={t('settings.tabs.feedback.websiteDescription')}
                />
                <SettingsSection.Body>
                    <button
                        type="button"
                        onClick={() => void openExternal(WEBSITE_URL, 'feedback open website')}
                        className={actionBtnCls}
                    >
                        <span className="truncate">{WEBSITE_URL.replace(/^https?:\/\//, '')}</span>
                        <ExternalLink
                            size={13}
                            strokeWidth={2}
                            className="text-[#9CA3AF] dark:text-[#666] ml-auto shrink-0"
                        />
                    </button>
                </SettingsSection.Body>
            </SettingsSection>
        </div>
    );
}
