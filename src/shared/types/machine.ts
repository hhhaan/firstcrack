export interface Machine {
  id: string;
  name: string;
  roasterKey: string;
  displayName: string;
  brand: string;
  models: string[];
  protocol: string;
  connectionParams: Record<string, unknown>;
  capabilities: string[];
  pid: { Kp: number; Ki: number; Kd: number } | null;
  createdAt: string;
}

// GET /roasters 응답
export interface RoasterFormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface RoasterDef {
  display_name: string;
  brand: string;
  models: string[];
  protocol: string;
  capabilities: string[];
  pid: { Kp: number; Ki: number; Kd: number } | null;
  form_fields: RoasterFormField[];
  default_params: Record<string, unknown>;
}

export type RoastersResponse = Record<string, RoasterDef>;

// GET /status 응답
export interface SidecarStatus {
  connected: boolean;
  roaster: string;
  display_name: string;
  brand: string;
  uptime: number;
  error: string | null;
}

// GET /temperatures 응답
export interface TemperatureReading {
  bt: number | null;
  et: number | null;
  ror: number;
  ror_et: number;
  heater: number;
  fan: number;
  drum: number;
  timestamp: number;
}
