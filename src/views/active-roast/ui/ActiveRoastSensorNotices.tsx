interface ActiveRoastSensorNoticesProps {
    showAutoChargeUnavailable: boolean;
    showAutoDropUnavailable: boolean;
    autoChargeMessage: string;
    autoDropMessage: string;
}

export const ActiveRoastSensorNotices = ({
    showAutoChargeUnavailable,
    showAutoDropUnavailable,
    autoChargeMessage,
    autoDropMessage,
}: ActiveRoastSensorNoticesProps) => (
    <>
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
