import { UnsavedRoastBanner } from './UnsavedRoastBanner';

interface ActiveRoastSensorNoticesProps {
    showUnsavedBanner: boolean;
    unsavedTime: string;
    onReopenUnsaved: () => void;
    showAutoChargeUnavailable: boolean;
    showAutoDropUnavailable: boolean;
    autoChargeMessage: string;
    autoDropMessage: string;
}

export const ActiveRoastSensorNotices = ({
    showUnsavedBanner,
    unsavedTime,
    onReopenUnsaved,
    showAutoChargeUnavailable,
    showAutoDropUnavailable,
    autoChargeMessage,
    autoDropMessage,
}: ActiveRoastSensorNoticesProps) => (
    <>
        {showUnsavedBanner && <UnsavedRoastBanner timeStr={unsavedTime} onReopen={onReopenUnsaved} />}
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
