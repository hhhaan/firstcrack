# First Crack Sidecar API

작성일: 2026-05-08 · 갱신일: 2026-07-19

이 문서는 `src-tauri/sidecar/main.py`의 현재 `aiohttp` 기반 HTTP API를 기준으로 한다. 프론트엔드는 `src/shared/lib/sidecar.ts`에서 이 API를 호출한다.

## Server

- Framework: `aiohttp`
- Base URL: `http://127.0.0.1:9999`
- Content-Type: JSON 요청은 `application/json`
- CORS: allowlist origin만 허용 — `tauri://localhost`(macOS 번들), `http://tauri.localhost`(Windows 번들), `http://localhost:1420`(dev). allowlist origin에는 `Access-Control-Allow-Private-Network: true`도 함께 반환 (Chromium PNA 정책 대응)
- Startup behavior: 서버 시작 시 아무 로스터에도 자동 연결하지 않는다. 프론트엔드가 `POST /connect`를 호출해야 연결이 시작된다.

```py
web.run_app(create_app(), host="127.0.0.1", port=9999, print=None)
```

## Response Types

### SidecarStatus

`GET /status`, `POST /connect`, `POST /disconnect`가 반환한다.

```ts
interface SidecarStatus {
    connected: boolean;
    roaster: string;
    display_name: string;
    brand: string;
    uptime: number;
    error: string | null;
}
```

### TemperatureReading

`GET /temperatures`가 반환한다.

```ts
interface TemperatureReading {
    bt: number | null;
    et: number | null;
    ror: number;
    ror_et: number;
    heater: number;
    fan: number;
    drum: number;
    timestamp: number;
}
```

필드 의미:

| Field       | Meaning                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| `bt`        | Bean Temperature, 원두 온도. 섭씨.                                               |
| `et`        | Environment Temperature, 환경/배기 온도. 섭씨.                                   |
| `ror`       | BT 기준 Rate of Rise. 최근 30초 BT window의 선형 최소제곱 기울기. 단위 `°C/min`. |
| `ror_et`    | ET 기준 Rate of Rise. 최근 30초 ET window의 선형 최소제곱 기울기. 단위 `°C/min`. |
| `heater`    | 히터/버너 출력 값. adapter에 따라 0-100 또는 장비 raw 값.                        |
| `fan`       | 팬 출력 값. adapter에 따라 0-100 또는 장비 raw 값.                               |
| `drum`      | 드럼 속도 값. adapter에 따라 0-100, RPM %, 또는 raw speed.                       |
| `timestamp` | Python `time.monotonic()` 값.                                                    |

연결이 없거나 읽기에 실패하면 아래 fallback을 반환한다.

```json
{
    "bt": null,
    "et": null,
    "ror": 0.0,
    "ror_et": 0.0,
    "heater": 0,
    "fan": 0,
    "drum": 0,
    "timestamp": 483729.129392
}
```

`timestamp`는 fallback에서도 `time.monotonic()`으로 채워지므로 호출마다 값이 다르다.

### SerialPort

`GET /serial-ports`가 반환한다.

```ts
interface SerialPort {
    device: string;
    description: string;
}
```

### RoastersResponse

`GET /roasters`가 반환한다.

```ts
type RoastersResponse = Record<string, RoasterDef>;

interface RoasterDef {
    display_name: string;
    brand: string;
    models: string[];
    protocol: string;
    capabilities: string[];
    pid: { Kp: number; Ki: number; Kd: number } | null;
    form_fields: RoasterFormField[];
    default_params: Record<string, unknown>;
}

interface RoasterFormField {
    key: string;
    label: string;
    type: 'text' | 'number' | 'select';
    required: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
}
```

`/roasters` 응답의 `default_params`에서는 내부 주소맵 필드가 제거된다.

제거되는 필드:

- `channels`
- `channel_nodes`
- `pid_db`
- `pid_sv_register`
- `modbus_registers`

즉, 프론트엔드는 로스터 연결 폼에 필요한 기본값만 받고, 실제 BT/ET 주소값은 sidecar 내부 `roaster_registry.py`에 남는다.

## Endpoints

### GET /roasters

지원 로스터 목록과 프로토콜별 연결 폼 필드를 반환한다.

Request body: 없음

Response: `RoastersResponse`

Example:

```http
GET /roasters HTTP/1.1
Host: 127.0.0.1:9999
```

Response shape:

```json
{
    "virtual": {
        "display_name": "가상 머신",
        "brand": "Internal",
        "models": ["가상 머신"],
        "protocol": "virtual",
        "capabilities": [],
        "pid": null,
        "form_fields": [],
        "default_params": {
            "mode": "C"
        }
    }
}
```

Notes:

- 데이터 원천은 `ROASTER_REGISTRY`와 `PROTOCOL_FORM_FIELDS`다.
- 새 로스터를 `roaster_registry.py`에 추가하면 이 API에 자동 반영된다.

### GET /status

현재 sidecar 연결 상태를 반환한다.

Request body: 없음

Response: `SidecarStatus`

Example response:

```json
{
    "connected": true,
    "roaster": "virtual",
    "display_name": "가상 머신",
    "brand": "Internal",
    "uptime": 12.4,
    "error": null
}
```

Notes:

- `uptime`은 현재 연결이 유지된 시간이며 초 단위다.
- 연결이 없으면 `connected=false`, `uptime=0`, `roaster=""`가 된다.
- 마지막 연결/읽기 오류가 있으면 `error`에 사용자 친화 메시지가 들어간다.

### POST /connect

선택한 로스터에 연결한다. 이미 연결된 adapter가 있으면 먼저 disconnect 후 새 adapter를 만든다.

Request body:

```ts
{
  roaster: string;
  [connectionParam: string]: unknown;
}
```

Example:

```json
{
    "roaster": "giesen_standard",
    "host": "172.30.30.50",
    "port": 102,
    "rack": 0,
    "slot": 0
}
```

Response: `SidecarStatus`

Success response example:

```json
{
    "connected": true,
    "roaster": "giesen_standard",
    "display_name": "Giesen W6A / W15A / W30A / W45A / W60A",
    "brand": "Giesen",
    "uptime": 0.0,
    "error": null
}
```

Error responses:

```json
{ "error": "invalid JSON" }
```

Status: `400`

```json
{ "error": "roaster field required" }
```

Status: `400`

```json
{ "error": "알 수 없는 로스터: <roaster>" }
```

Status: `400`

Connection failure behavior:

- adapter 연결 중 예외가 발생해도 HTTP status는 현재 `200`이다.
- 이 경우 `SidecarStatus.connected`가 `false`가 되고 `error`에 실패 이유가 들어간다.

### POST /disconnect

현재 연결을 해제한다.

Request body: 없음

Response: `SidecarStatus`

Example response:

```json
{
    "connected": false,
    "roaster": "",
    "display_name": "",
    "brand": "",
    "uptime": 0,
    "error": null
}
```

Notes:

- 내부 adapter의 `disconnect()`에서 예외가 발생해도 무시하고 상태를 초기화한다.
- RoR 계산 window도 함께 초기화한다.

### GET /temperatures

현재 연결된 로스터 adapter에서 live reading을 읽고, sidecar가 RoR 값을 계산해 반환한다.

Request body: 없음

Response: `TemperatureReading`

Example response:

```json
{
    "bt": 184.2,
    "et": 215.8,
    "ror": 7.24,
    "ror_et": -0.12,
    "heater": 65,
    "fan": 42,
    "drum": 50.0,
    "timestamp": 483729.129392
}
```

Notes:

- `bt`, `et`는 adapter reading을 소수점 1자리로 반올림한다.
- `ror`, `ror_et`는 소수점 2자리로 반올림한다.
- `heater`, `fan`은 `int()`로 변환한다.
- `drum`은 소수점 1자리로 반올림한다.
- BT/ET가 0보다 큰 경우만 RoR window에 추가한다.
- RoR window는 최근 30초 값만 유지한다.
- 연결이 없거나 읽기 실패 시 fallback temperature response를 반환한다.
- 읽기 실패 시 manager는 `connected=false`로 전환하고 `error`를 기록한다.

Adapter별 원천:

| Protocol    | BT/ET source                                                  | Heater/Fan/Drum source                          |
| ----------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `virtual`   | 내부 profile `temp2`/`temp1`                                  | 가상 값                                         |
| `s7`        | `roaster_registry.py`의 `channels`에서 `role=BT/ET` DB/offset | `role=heater/fan/drum` 채널                     |
| `modbus`    | `modbus_registers.BT/ET`                                      | 현재 `drum`만 선택적으로 읽고, `heater/fan`은 0 |
| `phidget`   | `channel_bt`, `channel_et` 센서 채널                          | 모두 0                                          |
| `kaleido`   | `KaleidoPort.getBTET()`                                       | `HP`, `SM`, `RL` 상태값                         |
| `probat_ws` | `channel_nodes.BT/ET`가 가리키는 WebSocket data field         | `channel_nodes.heater/fan/drum`                 |

### POST /standby

READY 버튼과 연동되는 대기 진입 신호다.

Request body: 없음

Response:

```json
{ "ok": true }
```

Behavior:

- 현재 adapter에 `enter_standby()` 메서드가 있으면 호출한다.
- virtual adapter는 이 호출 시점을 기준으로 `_BEAN_LOAD_DELAY`(기본 8초) 후 생두 투입 시뮬레이션(BT 급강하)을 시작한다.
- 프론트엔드는 standby 단계 진입 시 이 엔드포인트를 호출해 자동 Charge 감지 루프를 활성화한다.

### POST /start

Charge 버튼과 연동되는 시작 신호다.

Request body: 없음

Response:

```json
{ "ok": true }
```

Behavior:

- BT RoR window를 초기화한다.
- ET RoR window를 초기화한다.
- 현재 adapter에 `start_roast()` 메서드가 있으면 호출한다.
- virtual adapter는 이 호출 시 profile 재생 시작 시간을 현재 시각으로 리셋한다.

### POST /reset

로스트 종료/리셋 신호다. 어댑터 상태를 초기화해 다음 로스트를 예열 상태에서 시작한다.

Request body: 없음

Response:

```json
{ "ok": true }
```

Behavior:

- `manager.reset_roast()`를 호출한다.

### POST /settings

프론트엔드 설정 변경을 사이드카 런타임에 반영한다.

Request body:

```ts
{
  ror_window_sec?: number;
}
```

Response:

```json
{ "ok": true }
```

Error response: `{ "error": "invalid JSON" }` (status 400)

Notes:

- 현재 지원 키는 `ror_window_sec`(RoR 계산 윈도우, 초)뿐이다. 알 수 없는 키는 무시된다.
- 숫자로 변환 불가한 값은 조용히 무시된다.

### POST /control

장비 제어값을 adapter로 전달한다.

Request body:

```ts
{
  heater?: number;
  fan?: number;
  drum?: number;
}
```

Example:

```json
{
    "heater": 70,
    "fan": 35,
    "drum": 50
}
```

Response:

```json
{ "ok": true }
```

Error response:

```json
{ "error": "invalid JSON" }
```

Status: `400`

Notes:

- manager가 연결 상태일 때만 adapter의 `control()`을 호출한다.
- 연결이 없어도 현재 API는 `{ "ok": true }`를 반환한다.
- 현재 대부분 adapter의 `control()`은 no-op이다.
- Kaleido adapter는 `heater`가 들어오면 `setSV()`를 호출한다.

### GET /serial-ports

OS에서 감지된 serial port 목록을 반환한다.

Request body: 없음

Response: `SerialPort[]`

Example response:

```json
[
    {
        "device": "/dev/cu.usbserial-XXXX",
        "description": "USB Serial"
    }
]
```

Notes:

- `pyserial`의 `serial.tools.list_ports.comports()`를 사용한다.
- `hwid`와 `description`이 모두 비어 있거나 `n/a`인 포트는 제외한다. 이 로직은 Bluetooth 가상 포트 필터링 목적이다.
- `pyserial` import에 실패하면 빈 배열을 반환한다.

## Debug & Lifecycle

### GET /debug/trace

프로토콜 트레이스 버퍼를 덤프한다.

Response:

```ts
{
  enabled: boolean;
  count: number;
  entries: TraceEntry[];
}
```

### POST /debug/trace

트레이스 on/off 및 버퍼 클리어.

Request body:

```ts
{
  enabled?: boolean;
  clear?: boolean;
}
```

Response: `{ "enabled": boolean }` · invalid JSON은 status 400.

### GET /debug/probe

단발 원시 읽기 + 그 동안의 트레이스를 반환한다 (Artisan A/B 비교용).

Behavior:

- probe 동안 트레이스를 일시 활성화하고, 완료 후 이전 활성화 상태로 복원한다 (best-effort — 동시 `POST /debug/trace`가 있으면 그 값이 우선).
- Response는 `manager.probe()` 결과에 `trace` 배열(probe 구간 트레이스)을 덧붙인 형태다.

### POST /shutdown

Graceful shutdown. Tauri Exit 핸들러에서 호출한다.

Response: `ok` (text) 반환 후 ~50ms 뒤 `os._exit(0)`.

## OPTIONS

모든 path에 대해 `OPTIONS /{path}`를 받는다.

Response:

- Empty response
- CORS header 포함

Headers:

```http
Access-Control-Allow-Origin: <allowlist origin echo>
Access-Control-Allow-Private-Network: true
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

`Access-Control-Allow-Origin`은 요청 Origin이 allowlist(`tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`)에 있을 때만 반환된다.

## Frontend Usage

프론트엔드 wrapper는 `src/shared/lib/sidecar.ts`에 있다.

```ts
const BASE = 'http://127.0.0.1:9999';
```

현재 wrapper:

| Function                              | Endpoint            |
| ------------------------------------- | ------------------- |
| `sidecar.getRoasters()`               | `GET /roasters`     |
| `sidecar.getStatus()`                 | `GET /status`       |
| `sidecar.connect(roasterKey, params)` | `POST /connect`     |
| `sidecar.disconnect()`                | `POST /disconnect`  |
| `sidecar.getTemperatures()`           | `GET /temperatures` |
| `sidecar.updateSettings(settings)`    | `POST /settings`    |
| `sidecar.enterStandby()`              | `POST /standby`     |
| `sidecar.startRoast()`                | `POST /start`       |
| `sidecar.resetRoast()`                | `POST /reset`       |
| `sidecar.getSerialPorts()`            | `GET /serial-ports` |

`POST /control`, `/shutdown`, `/debug/*`는 wrapper에 없다 — control은 현재 프론트에서 미사용, shutdown은 Tauri Rust 셸이 직접 호출, debug는 수동 진단용.

## Implementation Notes

- API handler 파일: `src-tauri/sidecar/main.py`
- 연결 상태 관리자: `src-tauri/sidecar/manager.py`
- 로스터별 주소맵: `src-tauri/sidecar/roaster_registry.py`
- Adapter factory: `src-tauri/sidecar/adapters/__init__.py`
- 공통 reading shape: `src-tauri/sidecar/adapters/base.py`
- 프론트 타입: `src/shared/types/machine.ts`
- 프론트 API wrapper: `src/shared/lib/sidecar.ts`

## Packaging & Deployment

프로덕션 배포 시 Python 런타임 없이 동작하도록 PyInstaller로 단일 바이너리를 빌드한다.

```bash
npm run build:sidecar   # → src-tauri/binaries/sidecar-aarch64-apple-darwin
npm run tauri build     # Tauri가 위 바이너리를 앱 번들에 포함
```

빌드 관련 파일:

| 파일 | 역할 |
| ---- | ---- |
| `src-tauri/sidecar/sidecar.spec` | PyInstaller spec — `main.py` 기준, arm64 타겟, 의존성 전체 포함 |
| `scripts/build-sidecar.sh` | `pyinstaller sidecar.spec` 실행 후 rustc target triple 이름으로 `src-tauri/binaries/`에 복사 |
| `src-tauri/src/lib.rs` | Tauri 앱 시작 시 `tauri_plugin_shell`로 sidecar 프로세스 spawn, stdout/stderr drain |

바이너리(`src-tauri/binaries/sidecar-*`)는 `.gitignore`에 등록되어 있으므로 배포 전 반드시 `npm run build:sidecar`를 먼저 실행해야 한다.

## Known Behavior To Preserve

- Tauri IPC가 아니라 localhost HTTP API를 사용한다.
- 프론트는 BT/ET 주소값을 직접 알지 않는다.
- 기기별 BT/ET 주소 분기는 `roaster_registry.py`의 `channels`, `modbus_registers`, `channel_nodes`, 또는 Phidget channel 설정으로 처리한다.
- `/roasters`는 내부 주소맵을 숨기고 폼 입력에 필요한 연결 파라미터만 반환한다.
- 연결 실패는 HTTP error로 던지지 않고 `SidecarStatus.error`에 담기는 경우가 있다.
