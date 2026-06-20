export {
    buildTypedConnectionParams,
    groupRoastersByBrand,
    initRoasterFormParams,
    isRoasterFieldVisible,
    isSameSidecarStatus,
    validateRoasterFormFields,
} from './lib';
export { useMachines, VIRTUAL_ID } from './model';
export { ROASTER_REGISTRY } from './roasterRegistry';
export type {
    Machine,
    RoasterDef,
    RoasterFormField,
    RoastersResponse,
    SerialPort,
    SidecarStatus,
    TemperatureReading,
} from './types';
