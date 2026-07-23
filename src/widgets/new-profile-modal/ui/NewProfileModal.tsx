import type { RoastProfileWithSource } from '@entities/roast-profile';
import type { RoastProfile } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useNewProfileForm } from '../model/useNewProfileForm';
import { ProfileFormBody } from './ProfileFormBody';
import { ProfileModePicker } from './ProfileModePicker';
import { ProfileSessionPicker } from './ProfileSessionPicker';

interface NewProfileModalProps {
    open: boolean;
    onClose: () => void;
    onCreated: (profile: RoastProfile) => void;
    editingProfile?: RoastProfileWithSource | null;
    onUpdated?: (profile: RoastProfile) => void;
    /** 열릴 때 이 세션으로 바로 from-session 모드 진입 */
    initialSessionId?: string | null;
}

export const NewProfileModal = ({
    open,
    onClose,
    onCreated,
    editingProfile,
    onUpdated,
    initialSessionId,
}: NewProfileModalProps) => {
    const form = useNewProfileForm({ open, onClose, onCreated, editingProfile, onUpdated, initialSessionId });

    if (!open) return null;

    return (
        <ModalShell onClose={onClose} labelledBy="new-profile-modal-title" contentClassName={modalPanel.formLg}>
            {form.mode === 'pick' && !editingProfile && (
                <ProfileModePicker onSelectMode={form.setMode} onClose={onClose} />
            )}
            {form.mode === 'session-list' && !editingProfile && (
                <ProfileSessionPicker
                    sessions={form.sessions}
                    onSelect={form.handleSessionSelect}
                    onBack={() => form.setMode('pick')}
                    onClose={onClose}
                />
            )}
            {(form.mode === 'manual' || form.mode === 'from-session') && (
                <ProfileFormBody
                    mode={form.mode}
                    form={form.form}
                    setField={form.setField}
                    nameRef={form.nameRef}
                    isEditing={!!editingProfile}
                    isValid={form.isValid}
                    selectedSession={form.selectedSession}
                    beans={form.beans}
                    blends={form.blends}
                    defaultType={form.defaultType}
                    setDefaultType={form.setDefaultType}
                    defaultBeanId={form.defaultBeanId}
                    setDefaultBeanId={form.setDefaultBeanId}
                    defaultBlendId={form.defaultBlendId}
                    setDefaultBlendId={form.setDefaultBlendId}
                    onBackToPick={() => form.setMode('pick')}
                    onClose={onClose}
                    onSubmit={form.handleSubmit}
                />
            )}
        </ModalShell>
    );
};
