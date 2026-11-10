let hopperOpenAllowed = () => false;

export const registerHopperOpenGuard = (allowed: () => boolean) => {
    hopperOpenAllowed = allowed;
};

export const canOpenHopper = () => hopperOpenAllowed();
