import { DropCancelControlBanner } from './DropCancelControlBanner';
import { UnsavedRoastBanner } from './UnsavedRoastBanner';

interface ActiveRoastSensorNoticesProps {
    showUnsavedBanner: boolean;
    unsavedTime: string;
    onReopenUnsaved: () => void;
    showDropCancelControlWarning: boolean;
    dropCancelControlMessage: string;
    showRestorePidAfterDropCancel: boolean;
    onRestorePidAfterDropCancel: () => void;
    restorePidBusy: boolean;
    showAutoChargeUnavailable: boolean;
    showAutoDropUnavailable: boolean;
    autoChargeMessage: string;
    autoDropMessage: string;
}

export const ActiveRoastSensorNotices = ({
    showUnsavedBanner,
    unsavedTime,
    onReopenUnsaved,
    showDropCancelControlWarning,
    dropCancelControlMessage,
    showRestorePidAfterDropCancel,
    onRestorePidAfterDropCancel,
    restorePidBusy,
    showAutoChargeUnavailable,
    showAutoDropUnavailable,
    autoChargeMessage,
    autoDropMessage,
}: ActiveRoastSensorNoticesProps) => (
    <>
        {showUnsavedBanner && <UnsavedRoastBanner timeStr={unsavedTime} onReopen={onReopenUnsaved} />}
        {showDropCancelControlWarning && (
            <DropCancelControlBanner
                message={dropCancelControlMessage}
                showRestorePid={showRestorePidAfterDropCancel}
                restoreBusy={restorePidBusy}
                onRestorePid={onRestorePidAfterDropCancel}
            />
        )}
        {showAutoChargeUnavailable && (
            <p role="status" className="text-sm text-muted-foreground">
                {autoChargeMessage}
            </p>
        )}
        {showAutoDropUnavailable && (
            <p role="status" className="text-sm text-muted-foreground">
                {autoDropMessage}
            </p>
        )}
    </>
);
