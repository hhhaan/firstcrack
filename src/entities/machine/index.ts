export type { ArtisanMachineIssue, ArtisanMachineMapping } from './artisan';
export { mapArtisanMachine } from './artisan';
export type { FirescopeMachineIssue, FirescopeMachineMapping } from './firescope';
export { firescopeFeedbackUpdate, mapFirescopeMachine } from './firescope';
export {
    addressFormFieldsForProtocol,
    buildProtocolRoasterDef,
    buildTypedConnectionParams,
    CUSTOM_CONNECT_KEYS,
    copyMachineSnapshot,
    EMPTY_MACHINE_SNAPSHOT,
    flattenAddressMaps,
    groupRoastersByBrand,
    initRoasterFormParams,
    invalidSupportedAddressField,
    isCustomConnectKey,
    isRoasterFieldVisible,
    isSameSidecarStatus,
    listProtocols,
    nestAddressMaps,
    networkScanProtocol,
    PROTOCOLS_WITH_ADDRESS_MAP,
    resolveCustomConnectKey,
    snapshotFromSidecar,
    supportedAddressFieldsForProtocol,
    validateAddressMaps,
    validateRoasterFormFields,
    writeMapFormFlags,
} from './lib';
export { useMachines, VIRTUAL_ID } from './model';
export { PROTOCOL_FORM_FIELDS, ROASTER_REGISTRY } from './roasterRegistry';
export type {
    ControlCapability,
    ControlLimit,
    Machine,
    MachineSnapshot,
    NetworkHost,
    PidCapability,
    PidRuntime,
    PidState,
    RoasterDef,
    RoasterFormField,
    RoastersResponse,
    SerialPort,
    SidecarStatus,
    TemperatureReading,
} from './types';
