let hopperCommandsAllowed = () => false;

export const registerHopperCommandGuard = (allowed: () => boolean) => {
    hopperCommandsAllowed = allowed;
};

export const canSendHopperCommand = () => hopperCommandsAllowed();
