import { useEffect, useState } from 'react';
import { Building2, Link, Check, User } from 'lucide-react';
import { useWorkspaceStore } from '@shared/store/workspace';
import { useAuthStore } from '@shared/store/auth';
import { useProfile } from '../../../entities/profile';

const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <section className="bg-white border border-[#E5E7EB] rounded-xl p-5">{children}</section>
);

const inputCls =
    'w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-[14px] text-[#111827] font-normal outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-colors';

export const WorkspaceSettingsTab = () => {
    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');
    const workspaceName = useWorkspaceStore((s) => s.workspaceName);
    const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);

    const [localName, setLocalName] = useState(workspaceName);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

    useEffect(() => {
        setLocalName(workspaceName);
    }, [workspaceName]);

    const handleSave = () => {
        const trimmed = localName.trim();
        if (!trimmed) return;
        setWorkspaceName(trimmed);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
    };

    return (
        <div className="grid gap-4">
            <SectionCard>
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-[10px] bg-[#F3F4F6] flex items-center justify-center">
                        <Building2 size={18} strokeWidth={1.8} className="text-[#6B7280]" />
                    </div>
                    <div>
                        <h4 className="text-[15px] font-semibold text-[#111827] m-0">Workspace</h4>
                        <p className="text-[12px] text-[#6B7280] m-0 mt-0.5">
                            Configure your workspace name and team settings
                        </p>
                    </div>
                </div>

                <label className="block text-[13px] font-medium text-[#374151] mb-1.5">Workspace display name</label>
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        value={localName}
                        onChange={(e) => setLocalName(e.target.value)}
                        placeholder="My Roastery"
                        className={inputCls}
                    />
                    <button
                        onClick={handleSave}
                        disabled={!localName.trim() || localName.trim() === workspaceName}
                        className="shrink-0 px-4 py-2.5 rounded-lg bg-[#111827] text-white text-[13px] font-semibold border hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-all cursor-pointer"
                    >
                        Save
                    </button>
                    {saveStatus === 'saved' && (
                        <span className="flex items-center gap-1 text-[13px] text-green-600 font-medium shrink-0">
                            <Check size={14} strokeWidth={2.5} />
                            Saved
                        </span>
                    )}
                </div>
            </SectionCard>

            {user && (
                <SectionCard>
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-1">Connected account</h4>
                    <p className="text-[13px] text-[#6B7280] m-0 mb-4">This workspace is linked to your account.</p>
                    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white">
                        <div className="w-8 h-8 rounded-full bg-[#111827] flex items-center justify-center text-sm font-semibold text-white shrink-0">
                            {(profile?.display_name || user.email || '').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-[#111827]">
                                {profile?.business_name || profile?.display_name || 'User'}
                            </div>
                            <div className="text-[12px] text-[#6B7280] truncate">{user.email}</div>
                        </div>
                        <div className="flex items-center gap-1 text-[12px] text-green-600 font-medium">
                            <Link size={13} strokeWidth={2} />
                            Connected
                        </div>
                    </div>
                </SectionCard>
            )}

            <SectionCard>
                <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-1">Team workspace</h4>
                <p className="text-[13px] text-[#6B7280] m-0 mb-4">
                    Invite team members to collaborate on roasts, beans, and profiles.
                </p>
                <button
                    disabled
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] text-[13px] font-medium text-[#9CA3AF] cursor-not-allowed"
                >
                    <User size={14} strokeWidth={2} />
                    Invite members
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280] ml-auto">
                        Coming soon
                    </span>
                </button>
            </SectionCard>
        </div>
    );
};
