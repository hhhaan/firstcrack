import { logger } from '@shared/lib/logger';
import { SectionCard } from '@shared/ui/SectionCard';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const SUPPORT_EMAIL = 'support@firstcrackiscoming.com';
const WEBSITE_URL = 'https://firstcrackiscoming.com';

const actionBtnCls =
    'flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#262B31] text-[13px] font-medium text-[#111827] dark:text-[#e5e5e5] hover:bg-[#F9FAFB] dark:hover:bg-[#181d21] active:opacity-90 transition-all cursor-pointer';

async function openExternal(url: string, context: string) {
    try {
        await openUrl(url);
    } catch (e) {
        logger.capture(e, { context });
    }
}

export function SupportSettingsTab() {
    const { t } = useTranslation();

    return (
        <div className="grid gap-4">
            <SectionCard>
                <div className="flex items-start gap-3 mb-4">
                    <div className="mt-0.5 text-[#6B7280] dark:text-[#999]">
                        <Mail size={16} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0">
                        <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0 mb-1">
                            {t('settings.tabs.support.contactTitle')}
                        </h4>
                        <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0">
                            {t('settings.tabs.support.contactDescription')}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262B31] mb-3">
                    <span className="text-[14px] font-medium text-[#111827] dark:text-[#e5e5e5]">{SUPPORT_EMAIL}</span>
                </div>

                <button
                    type="button"
                    onClick={() => void openExternal(`mailto:${SUPPORT_EMAIL}`, 'support open email')}
                    className={actionBtnCls}
                >
                    <Mail size={14} strokeWidth={2} />
                    {t('settings.tabs.support.contactAction')}
                    <ExternalLink size={13} strokeWidth={2} className="text-[#9CA3AF] dark:text-[#666] ml-auto" />
                </button>
            </SectionCard>

            <SectionCard>
                <div className="flex items-start gap-3 mb-4">
                    <div className="mt-0.5 text-[#6B7280] dark:text-[#999]">
                        <ExternalLink size={16} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0">
                        <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0 mb-1">
                            {t('settings.tabs.support.websiteTitle')}
                        </h4>
                        <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0">
                            {t('settings.tabs.support.websiteDescription')}
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => void openExternal(WEBSITE_URL, 'support open website')}
                    className={actionBtnCls}
                >
                    <span className="truncate">{WEBSITE_URL.replace(/^https?:\/\//, '')}</span>
                    <ExternalLink
                        size={13}
                        strokeWidth={2}
                        className="text-[#9CA3AF] dark:text-[#666] ml-auto shrink-0"
                    />
                </button>
            </SectionCard>
        </div>
    );
}
