# First Crack Sidecar API

작성일: 2026-05-08 · 갱신일: 2026-10-22

이 문서는 `src-tauri/sidecar/main.py`의 현재 `aiohttp` 기반 HTTP API를 기준으로 한다. 프론트엔드는 `src/shared/lib/sidecar.ts`에서 이 API를 호출한다.

## Server

- Framework: `aiohttp`
- Base URL: `http://127.0.0.1:9999`
- Content-Type: JSON 요청은 `application/json`
- CORS: allowlist origin만 허용 — `tauri://localhost`(macOS 번들), `http://tauri.localhost`(Windows 번들), `http://localhost:1420`(dev). allowlist origin에는 `Access-Control-Allow-Private-Network: true`도 함께 반환 (Chromium PNA 정책 대응)
- Startup behavior: 서버 시작 시 아무 로스터에도 자동 연결하지 않는다. 프론트엔드가 `POST /connect`를 호출해야 연결이 시작된다.

### 인증 — `X-Sidecar-Token`

`127.0.0.1:9999`는 로컬 브라우저나 다른 로컬 프로세스도 호출할 수 있어 `/shutdown`·`/disconnect`가 로컬 CSRF 벡터가 된다. 이를 막기 위한 토큰 검증이 있다.

| 주체 | 동작 |
| ---- | ---- |
| `src-tauri/src/lib.rs` | 앱 프로세스당 토큰 1개 생성 → spawn/respawn 시 `SIDECAR_TOKEN` env로 주입. `RunEvent::Exit`의 `/shutdown` 요청에도 같은 토큰을 헤더로 실는다 |
| `main.py` | `SIDECAR_TOKEN`이 있으면 모든 요청에 `X-Sidecar-Token` 헤더를 요구하고 불일치 시 `401 {"error":"unauthorized"}`. **env가 없으면 검증을 건너뛴다** (venv 직접 실행 dev 호환) |
| `src/shared/lib/sidecar.ts` | Tauri 커맨드 `sidecar_token`으로 토큰을 받아 모든 요청 헤더에 첨부. 브라우저(web-only dev)에서는 invoke가 실패해 헤더 없이 호출한다 |

- `OPTIONS`는 토큰 없이 통과한다 — 브라우저 preflight에는 커스텀 헤더가 실리지 않는다.
- 401 응답에도 CORS 헤더가 붙는다 (토큰 미들웨어가 CORS 미들웨어 안쪽에 있다).

```py
web.run_app(create_app(), host="127.0.0.1", port=9999, print=None)
```

## Response Types

### SidecarStatus

`GET /status`, `POST /connect`, `POST /disconnect`가 반환한다.

```ts
interface SidecarStatus {
    connected: boolean;
    reconnecting: boolean;
    reconnect_attempt: number;
    roaster: string;
    display_name: string;
    brand: string;
    capabilities: string[];
    uptime: number;
    error: string | null;
}
```

### TemperatureReading

`GET /temperatures`가 반환한다.

```ts
interface TemperatureReading {
    bt: number | null; // display EMA
    bt_raw?: number | null; // validated, unsmoothed sensor BT; absent on older sidecars
    et: number | null; // display EMA
    et_raw?: number | null; // unsmoothed sensor ET; absent on older sidecars
    ror: number;
    ror_et: number;
    heater: number | null;
    fan: number;
    drum: number;
    heater_set: number | null;
    timestamp: number;
    sensor_clock?: string; // sidecar instance UUID + connection epoch
    processing?: {
        algorithm_version: string;
        temperature_unit: 'C';
        ror_unit: 'C/min';
        timestamp_clock: 'sidecar-monotonic-seconds';
    display_ema_alpha: number;
    et_display_ema_alpha?: number; // legacy records use display_ema_alpha for ET too
        ror_ema_alpha: number; // BT RoR EMA. Runtime default 1
        et_ror_ema_alpha?: number; // ET RoR EMA. Older recordings used ror_ema_alpha for both
        ror_window_sec: number;
        ror_warmup_reads: number;
    };
    stale: boolean;
    reconnecting: boolean;
}
```

필드 의미:

| Field       | Meaning                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| `bt`        | Bean Temperature, 표시용 EMA 원두 온도. 섭씨.                                               |
| `bt_raw`    | 평활화 전 원시 BT (°C). Charge 감지용. `stale` 또는 연결 해제 응답에서는 null이다. 이전 사이드카의 필드 누락 시 자동 Charge를 중단하고 수동 투입을 안내한다. |
| `et`        | Environment Temperature, 표시용 EMA. 섭씨. 차트·기록의 환경/배기 온도는 이 값이다. |
| `et_raw`    | 평활화 전 원시 ET (°C). 보관·이후 검증용이며 차트와 자동 감지에는 쓰지 않는다. `stale`, 연결 해제, `NaN`/`Inf`에서는 null이다. 프로브가 없으면 -1.0이 그대로 남는다. |
| `ror`       | BT 기준 Rate of Rise. 최근 30초 BT window의 선형 최소제곱 기울기. 단위 `°C/min`. |
| `ror_et`    | ET 기준 Rate of Rise. 최근 30초 ET window의 선형 최소제곱 기울기. 단위 `°C/min`. |
| `heater`    | 히터/버너 출력 값. adapter에 따라 0-100 또는 장비 raw 값. 화력 피드백 채널이 없는 머신(Phidget, heater 미매핑 Modbus/Probat WS)은 `null`. |
| `fan`       | 팬 출력 값. adapter에 따라 0-100 또는 장비 raw 값.                               |
| `drum`      | 드럼 속도 값. adapter에 따라 0-100, RPM %, 또는 raw speed.                       |
| `heater_set` | 사이드카가 이 연결에서 마지막으로 쓴 heater 세트포인트(클램프 후). 수동 `/control`·Replay·PID 쓰기 모두 포함. 쓰기 전·쓰기 맵 없는 머신·해제 후는 `null`. 본체 조작반에서 돌린 값은 반영되지 않는다. |
| `timestamp` | Python `time.monotonic()` 값.                                                    |
| `stale`     | 직전 read가 실패해 이전 성공 값을 그대로 반환 중임 (fail-open, 최대 `STALE_TOLERANCE_READS`회). |
| `reconnecting` | 백그라운드 자동 재연결 태스크가 동작 중임.                                    |

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
    "heater_set": null,
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

로컬 로스팅 설정 가져오기는 Tauri IPC로 실행한다. Python HTTP 엔드포인트는 없다. 명령과 snapshot 계약은 [로컬 설정 가져오기](roasting-settings-import.md)를 참조한다.

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
- `control.limits.<role>`는 write_map의 스케일(`min`/`max`/`unit`). `giesen_wxa_coarse` heater는 `max=10`, `unit=step`. 수렴·이탈 허용치는 이 `max`에서 같이 유도한다(이탈 ≥ 수렴).

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
    "heater_set": 65,
    "timestamp": 483729.129392
}
```

Notes:

- `bt`, `et`는 adapter reading을 소수점 1자리로 반올림한다.
- `ror`, `ror_et`는 소수점 2자리로 반올림한다.
- `heater`, `fan`은 `int()`로 변환한다. `heater`는 채널이 없으면 `null`(0 아님).
- `drum`은 소수점 1자리로 반올림한다.
- BT/ET가 0보다 큰 경우만 RoR window에 추가한다.
- RoR window는 최근 30초 값만 유지한다.
- 연결이 없거나 읽기 실패 시 fallback temperature response를 반환한다.
- 읽기 실패 시 manager는 `connected=false`로 전환하고 `error`를 기록한다.

읽기 실패 판정 (manager 공통 경로):

- `adapter.read()`는 `config.READ_TIMEOUT`(3.0s) 전역 타임아웃 안에서 await한다. 초과하면 읽기 실패로 처리한다. 단, executor 스레드에서 도는 동기 드라이버 자체는 중단되지 않는다 — HTTP 핸들러만 풀려난다.
- BT가 `config.BT_VALID_MIN_C` 이하이거나 `config.BT_VALID_MAX_C` 이상, 또는 NaN/Inf면 **예외 없이 반환됐더라도 읽기 실패로 승격**한다. 어댑터가 실패를 `-1.0` 같은 센티넬로 인코딩하는 경우(Phidget 분리, Kaleido 핸드셰이크 유실, Probat 노드 누락)를 잡기 위한 것이다.
- ET는 검증하지 않는다. ET 미장착 머신에서 `-1.0`은 정상적인 "채널 없음" 값이다.
- 실패가 `STALE_TOLERANCE_READS`회 이하이고 직전 성공 값이 있으면 그 값을 `stale=true`로 반환한다. 초과하면 `connected=false` + 재연결 루프로 전환하고 `bt=null`을 반환한다.
- read await 도중 `/disconnect` 등으로 어댑터가 교체되면 그 응답(성공/실패 모두)은 버리고 null payload를 반환한다 — 사라진 머신의 값이 `stale`로 새어나오지 않게 한다.

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

Request body: 생략하거나 `ChargeRequest`를 보낸다. 구조화된 Charge 형식은 아래 FSD 절을 따른다.

Response:

```json
{ "ok": true, "charge": null, "curve_eligible": false }
```

Behavior:

- 위 응답은 바디 없는 legacy 요청이다. FSD 제어용 Charge 원점을 만들지 않는다.
- 새 Charge는 BT·ET RoR window를 초기화하고 adapter의 `start_roast()`를 알린다.
- 동일한 구조화된 Charge 재전송은 기존 원점을 반환하며 필터나 adapter 타이머를 다시 초기화하지 않는다.
- 구조화된 Charge가 열려 있으면 바디 없는 legacy 요청은 `409`다.

### POST /reset

로스트 종료/리셋 신호다. 배치 계산/PID 상태를 초기화한다. 실제 장비 연결은 유지하고, 가상 머신만 재연결해 예열 상태로 되돌린다.

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
  bt_display_ema_alpha?: number; // 0.08–1; runtime default 1 (raw sample). PID stays at 0.16
  et_display_ema_alpha?: number; // 0.08–1; runtime default 1 (raw sample)
  ror_ema_alpha?: number; // 0.08–1; BT RoR EMA. Runtime default 1 (sensor samples inside the span)
  et_ror_ema_alpha?: number; // 0.08–1; ET RoR EMA. Runtime default 1
}
```

BT and ET display EMA changes take effect on the next fresh sample without resetting accumulated state. PID PV retains the fixed 0.16 BT EMA. RoR and ET RoR EMA are independent of the display settings and of each other. The least-squares span stays `ror_window_sec`. The sample's `processing` metadata records the actual display and RoR coefficients.

Response:

```json
{ "ok": true }
```

Error response: `{ "error": "invalid JSON" }` (status 400)

Notes:

- 지원 키는 `ror_window_sec`, `bt_display_ema_alpha`, `et_display_ema_alpha`, `ror_ema_alpha`, `et_ror_ema_alpha`다. 알 수 없는 키는 무시된다.
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

- 상태 코드: `400` 형식 오류(JSON이 객체가 아님, 비수치, NaN/Inf), `409` 미연결·쓰기 미지원.
  값이 없는 빈 요청 `{}`만 연결 여부와 무관하게 `200` no-op이다.
- 응답의 `applied`는 클램프 이후의 논리값이다 — PLC 인코딩 값과 구분한다.
- 클래식 Giesen DB2 기본 화력 맵은 `verify_readback=true`로 전송 뒤 같은 설정 셀을
  새로 읽고 인코딩 바이트가 일치해야 `applied`를 반환한다. 불일치·읽기 실패는 `502`이며
  마지막 성공 명령을 갱신하지 않는다. 한 API 요청 안에서는 자동 재전송하지 않는다. raw 1은 논리 0 설정 확인이고
  raw 0(AUTO)은 성공이 아니다. 검증은 쓰기와 같은 I/O 잠금·연결 세대에서 수행한다.
  이 응답은 실측 화력이나 소화 확인이 아니며 다른 장비·커스텀 맵에는 검증을 일괄 적용하지 않는다.
- Replay 재시도 요청은 같은 화력과 `retry_epoch`(최초 명령의 연결 세대, 0 이상의 정수)를 보낸다.
  해당 연결의 마지막 요청 화력과 같고 PID가 꺼져 있어야 하며 최대 2회 추가 요청만 허용한다.
  Giesen 검증 맵은 새 설정값이 이미 일치하면 쓰지 않고 성공 응답한다. 불일치일 때만 1회 재전송하고
  확인한다. 읽기 실패는 `502`, 연결·제어권 교체·횟수 초과는 `409`, 잘못된 `retry_epoch`는 `400`이다.
  새로운 화력 명령이나 PID 시작이 I/O 대기·재확인 중에 끼어들면 이전 S7 재시도는 쓰지 않는다.
  확인 미지원 어댑터는 동일한 논리 명령을 다시 쓰며 응답 의미는 기존 전송 계약을 따른다.
- 클래식 Giesen DB2.14 계열(Standard W6A/W6E/W15A, W1, Sample, W15E,
  W30A/PRO, W45A/W60A, W140A v1/v2, WxA/+)은 논리 화력 0~100%를 사용하며,
  S7 쓰기 경계에서 `value_offset=1`을 더해 DB2.14에 1~101을 전송한다.
  0%는 raw 1이고 raw 0(AUTO)은 보내지 않는다. `applied`/`heater_set`은 논리 0%를 유지한다.
  `value_offset`은 byte 주소 `offset`과 별개이며, 생략 시 0이다. 실측 피드백에는 적용하지 않는다.
  WxA coarse는 논리 0~10 step을 raw 1~11로 전송한다. W6A PRO(DB1001.42)는 오프셋 없이 0~100을 쓴다.
  저장된 heater 맵이 해당 모델의 구형 기본 맵 또는 읽기 검증 추가 전 기본 맵과 정확히 일치할 때 새 기본 맵으로 업그레이드한다.
  커스텀 주소·스케일·오프셋은 보존한다. 논리 0 입력·저장·Replay는 AUTO를 요청하지 않으며,
  raw 1에서 실제 버너/히터가 정지하는지는 모델별 실기 검증이 필요하다.
- 변경 안내 (#679): 기존 프로파일을 W45A/W60A 외 클래식 DB2 모델에서 Replay하면,
  1~100% 명령은 이전보다 1%p 높은 설정값으로 전달된다(누락된 +1 보정 복구).
  WxA coarse는 1~10 step 명령이 한 단계 높아진다. 커스텀 맵과 이미 보정된 W45A/W60A는 제외한다.
- 성공한 쓰기의 `applied`는 role별로 기억돼 `GET /temperatures`의 `heater_set`으로 나간다(해제 시 초기화).
- **쓰기는 `write_map`이 있는 로스터에서만 일어난다.** `write_map`은 레지스트리
  `default_params` 안에 있고, 읽기용 `channels`와 별도로 정의한다. Giesen 화력은
  피드백 DB2.48(읽기 전용)과 duty 세트포인트 DB2.14(쓰기 대상)가 다르다.
  클래식 W45A/W60A 드럼은 예외로 DB2.18을 읽고 쓴다.
- `write_map`에 없는 role 요청은 `400`, 쓰기 맵이 없는 로스터는 `409`를 반환한다.
  현재 쓰기 맵이 있는 것은 Giesen S7 계열(db2 계열 `DB2.14`, W6A PRO `DB1001.42`)의
  `heater`, 클래식 `giesen_w45a_w60a`의 `drum`, 가상 머신이다.
  W45A/W60A 드럼은 DB2.18 INT, 40~55 Hz, 오프셋 0이며 `/status.control.limits.drum`으로 노출한다.
  이 범위는 Artisan W45A/W60A 슬라이더 기준이며 Quantifiers 상한 45나 W60A Pro 범위와 구분한다.
  저장된 화력 전용 맵이 현재 또는 구형 기본 맵과 정확히 같으면 드럼을 추가하고, 커스텀 맵은 보존한다.
  다른 Giesen 키의 쓰기 맵은 heater만 유지한다. fan/압력 쓰기와 드럼 Replay는 지원하지 않는다.
  DB2.10은 Artisan에서 온도 SP로 지정돼 있으므로 팬 명령을 보내지 않는다.
- Probat `probat_gug_control_s7`는 heater(DB200.80, 0–100%), fan(DB200.64, 25–100%),
  drum(DB200.72, 25–60 RPM)을 지원한다. `probat_gug_s7`는 읽기 전용이다.
  `probat_ws`는 `burner`/`exhaustFan`/`drum` 노드를 0–100%로 쓰고, `probat_sample_ws`는
  `burner`만 지원한다. WebSocket 쓰기 맵은 유효한 `node`가 있어야 하며 범위만 있으면 쓰기 미지원이다.
  `setControlParams` 성공은 소켓 전송 완료를 뜻하며, 기기의 수락 응답이나 실제 동작을 확인하지 않는다.
- 어댑터 쓰기 순서: `min`/`max` 클램프 → `div` 역스케일(읽기의 ÷10/÷100 반대) → `value_offset` 추가 →
  INT16 반올림·범위 검사 → `db_write`. 유한하지 않은 값(NaN/Inf)과 INT16 초과는
  `ValueError`로 거부한다.
- S7은 읽기와 쓰기가 같은 snap7 클라이언트를 쓰므로 어댑터 내부 스레드 락으로 직렬화한다.
- Kaleido/Modbus/Phidget adapter는 제어 쓰기를 지원하지 않는다. Virtual은
  명령값을 저장해 이후 판독에 반영한다(실기 없이 제어 UI를 확인하는 용도).

### POST /pid/on · /pid/off · /pid/sv

소프트웨어 PID. BT를 목표 온도(SV)로 추종하도록 heater duty를 계산해 쓴다.
Giesen을 포함한 대부분의 로스터에는 PLC 내장 PID가 없어(`PID_area=0`) 이 경로가
유일한 자동 화력 제어 수단이다.

| 엔드포인트 | 바디 | 응답 |
|---|---|---|
| `POST /pid/on` | `{ "sv": 200 }` | `{ "ok": true, "pid": {...} }` |
| `POST /pid/off` | `{ "mode": "hold" \| "zero" }` (생략 시 `hold`) | 같음 |
| `POST /pid/sv` | `{ "sv": 215 }` | 같음 |

상태 코드: `400` 형식/범위 오류, `409` 미연결·PID 미지원·미실행.

PID를 켜려면 레지스트리에 **게인(`pid`)과 heater `write_map`이 둘 다** 있어야 한다
(`GET /status.control.pid.supported`로 확인).

**안전 동작**

- 기본 OFF. 켜는 것은 항상 명시적 요청이다.
- engage 시 머신이 보고하는 현재 heater 값을 적분기에 시드해 화력 공백을 만들지 않는다.
- PV가 stale하거나 오래되면 `holding` — 쓰기를 멈추고 머신이 마지막 duty를 유지한다.
  `PID_HOLD_TIMEOUT_S`를 넘기면 `fault`.
- `fault` 진입 조건: hold 타임아웃, 연속 쓰기 실패(`PID_WRITE_FAIL_LIMIT`),
  BT > `SAFETY_MAX_BT_C`, 연결 끊김. 연결이 살아 있으면 heater 0을 재시도한다.
  fault는 자동 복귀하지 않는다 — 사용자가 다시 켜야 한다.
- `mode="hold"`는 배출 후 화력을 그대로 둔다(연속 배치용). 이상 정지는 mode와 무관하게 0.

**종료 시 명령과 관측의 구분**

Parent watchdog과 정상 종료는 manager의 disconnect 경로를 사용한다. PID operation이
있으면 기존 writer가 끝나기를 기다리고 논리 heater 0을 시도한 뒤 연결을 종료한다.
미완료 writer의 timeout은 완료로 보고하지 않는다. 전송 실패, 프로세스 정지나
머신의 명령 미반영까지 소프트웨어가 해결한다는 보장은 없다. 논리 명령이나 register
readback은 실제 소염·연료 차단의 관측이 아니다. 수동 화력만 사용 중인 disconnect가
새로운 heater 0 명령을 보낸다고 해석해서도 안 된다.

**런타임 상태**는 `GET /temperatures`의 `pid` 블록으로 나간다 (PID를 한 번 켠 뒤부터):

```json
{
    "state": "running",
    "sv": 200.0, "duty": 63.0, "pv": 198.4,
    "p": 32.0, "i": 25.4, "d": 5.6,
    "error": null
}
```

별도 폴링 엔드포인트를 두지 않은 이유: 프론트가 이미 `/temperatures`를 폴링 중이라
타이머를 하나 더 만들 이유가 없다. 정적 지원 여부만 `/status.control.pid`에 있다.

### FSD curve protocol

FSD는 같은 Charge 경과시간의 기록 BT를 추종한다. 기존 heater session과 PID runner를
재사용한다. `virtual-v1`은 명시적 machine identity가 있는 `sim: "thermal"` virtual만
지원한다. 기본 scripted virtual과 모든 물리 adapter의 curve capability는 false다.

완전한 wire 형식과 불변 조건은 [FSD-02 계약](agent/fsd-mode/fsd02-contract.md), 실제
TypeScript DTO는 `src/shared/types/sidecar.ts`에 있다.

| 요청 | 동작 |
| --- | --- |
| `POST /start` + `ChargeRequest` | 기존 앱 `session_id`, 현재 clock·epoch·generation, `origin.kind="now"` 또는 보관된 정확한 sample key를 받는다. `{ok,charge,server_time,elapsed_sec}`를 반환한다. |
| `POST /pid/on` + `mode="curve"` | Charge identity, 고유 `request_id`, 현재 generation, machine, `config_id="virtual-v1"`, 전체 frozen reference를 받는다. `{ok,pid,curve,server_time}`를 반환한다. |
| `POST /pid/renew` | 반환된 `CurveAuthority` 전체를 받는다. 살아 있는 같은 run의 lease만 서버 수락 시각부터 3초로 갱신한다. |
| `POST /pid/off` + `mode="curve"` | authority와 `user`, `drop`, `view_hidden`, `workspace_changed` 사유를 받는다. 기존 writer barrier 뒤에 virtual 논리 최소값 0을 적용한다. |
| `GET /pid/receipts?charge_id=...&after=0&limit=256` | 해당 Charge의 immutable receipt page를 반환한다. 최대 page는 512개, journal은 최근 2,048개다. |

Reference는 raw Celsius BT, acquisition 시각·clock, 전체 processing metadata, 저장된
machine identity, 명시적 Charge·Drop을 포함한다. 10~10,000개 point와 최대 1,800초를
허용한다. 인접 간격은 3초 이하다. Synthetic fallback, 표시 EMA와 잘못된 row를
버려서 만든 커브는 제어 source가 아니다. Curve JSON body 상한은 8 MiB다.

Reference와 live raw BT 모두 tau 2초의 동일한 dt EMA와 10초 warmup을 사용한다.
양쪽 raw TP와 초기 오차 조건을 통과한 명시적 시작만 허용한다. TP에 맞춰 시간축을
이동하지 않는다. 마지막 실제 reference 표본에서 제어를 끝내며 물리 Drop을 생성하지 않는다.

Curve lease와 reference 종료 deadline은 read·write 대기와 독립적으로 자동 권한을
회수한다. 상태·온도·receipt 조회와 start 재전송은 lease를 갱신하지 않는다. 종료된
authority와 지연된 이전 run의 stop은 새 run을 제어할 수 없다. Curve가 소유 중인
`/pid/sv` 요청은 `409`다. Fixed `{sv}`와 기존 hold·zero stop 형식은 유지한다.

`/status`는 `server_time`, `sensor_clock`, `charge`, `curve`, `curve_eligibility`,
`charge_history_oldest_at`, `control.pid.curve`를 제공한다. `/temperatures`도 현재 또는
마지막 curve snapshot을 포함한다. 시작·종료 phase와 runner state는 별개다.
Runner가 off여도 종결 쓰기가 pending·uncertain이면 완료된 정지가 아니다.

Receipt는 `(charge_id, sequence)`로 식별한다. Attempt, 실제 heater transmission,
completion, uncertainty와 늦은 reconciliation을 서로 다른 entry로 보존한다. 예전
권한의 늦은 실제 완료도 원래 journal에 남으며 현재 LastApplied를 덮지 않는다.
Heat feedback은 이 명령 증거와 별개다. Retention 뒤 cursor에는 명시적 `gap`이 붙고,
폐기된 journal은 `410 journal_unavailable`이다. 미래 cursor는 `400`이다.

새 요청 오류는 기존 `error`와 안정된 `code`, 해당 시 `field`를 포함한다. 입력 오류는
`400`, 상태·소유권 충돌은 `409`, 미완료 writer는 `504 write_uncertain`과
`uncertain:true`, transport 실패는 `502`다. 잘못된 nonempty JSON stop은 `400`이며
바디 없는 stop으로 처리하지 않는다.

격리 재현은 `rtk src-tauri/sidecar/.venv/bin/python scripts/verify-fsd.py curve --help`에서
시작한다. 검증 driver는 virtual만 만들고 소유한 ephemeral loopback port를 사용한다.
Port 9999의 기존 서비스는 사용하지 않는다.

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

### GET /scan-network

로컬 IPv4 `/24` 서브넷에서 프로토콜 기본 포트가 열린 호스트를 TCP connect로 열거한다 (handshake 없음).

Query:

| Param | Values |
| ----- | ------ |
| `protocol` | `s7` (102), `modbus_tcp` (502), `kaleido` (80), `probat_ws` (80) |

Response: `NetworkHost[]` — `[{ "host": "192.168.1.10" }, ...]`

Status:

- `400` — missing/unknown `protocol`
- Soft OS/scan failure → `200 []` (serial-ports와 동일)

Notes:

- 구현: `scanner.py` (`asyncio.open_connection`, semaphore ~100, timeout 0.5s)
- Windows 방화벽이 첫 스캔 시 프롬프트를 띄울 수 있음 → 거부 시 빈 목록
- Phase 1: 오픈 포트만 표시 (로스터 식별 없음)

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
Access-Control-Allow-Headers: Content-Type, X-Sidecar-Token
```

`Access-Control-Allow-Origin`은 요청 Origin이 allowlist(`tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`)에 있을 때만 반환된다.

## Frontend Usage

프론트엔드 wrapper는 `src/shared/lib/sidecar.ts`에 있다.

```ts
const BASE = 'http://127.0.0.1:9999';
```

요청 타임아웃: 기본 5s, `connect`만 20s. 사이드카 내부 핸드셰이크(Kaleido 15s, Phidget attach 최대 10s)가 끝나기 전에 UI가 실패로 단정하지 않도록 한 것이다.

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
| `sidecar.scanNetwork(protocol)`       | `GET /scan-network` |

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
| `src-tauri/src/lib.rs` | Tauri 앱 시작 시 `tauri_plugin_shell`로 sidecar 프로세스 spawn, stdout/stderr drain. spawn 실패는 비치명 — 앱은 정상 기동하고 워치독이 백오프 재시도하며, 모두 실패하면 `sidecar-dead` 이벤트를 emit한다 |

바이너리(`src-tauri/binaries/sidecar-*`)는 `.gitignore`에 등록되어 있으므로 배포 전 반드시 `npm run build:sidecar`를 먼저 실행해야 한다.

## Known Behavior To Preserve

- Tauri IPC가 아니라 localhost HTTP API를 사용한다.
- preset 내부 BT/ET 주소맵은 공개하지 않는다. 사용자 정의 연결과 설정 import는 명시적인 주소를 프론트에서 검증·전달한다.
- 기기별 BT/ET 주소 분기는 `roaster_registry.py`의 `channels`, `modbus_registers`, `channel_nodes`, 또는 Phidget channel 설정으로 처리한다.
- `/roasters`는 내부 주소맵을 숨기고 폼 입력에 필요한 연결 파라미터만 반환한다.
- 연결 실패는 HTTP error로 던지지 않고 `SidecarStatus.error`에 담기는 경우가 있다.

### TSV measurement archive

The first line stays the column header. Columns 9–13 are `et_raw`, `bt_raw`, `ror_et`, `sensor_timestamp`, and `sensor_clock`. Missing columns in older recordings read as null. `sensor_timestamp` is the adapter read time from Python `time.monotonic()`, in seconds, not UTC or Charge-relative time. Preserve its full precision. `sensor_clock` identifies the sidecar instance and connection epoch; do not compare sample times or carry filter state across different epochs. A synthetic Charge point has no sensor timestamp or clock.

`# processing\t{JSON}` lines describe the calculation settings for following samples. They are written at the first archived sample with known settings and whenever settings change, and retained during Drop clipping and BBP saving. `# processing\tnull` clears the context when a sidecar supplies no settings. The archive reader validates these records and skips malformed metadata without discarding temperature samples. External TSV readers must skip comment lines.

The metadata records the actual sidecar RoR window, BT RoR EMA, ET RoR EMA, display EMA alphas, warmup read count, units, timestamp clock, and algorithm version. Older archives omit `et_ror_ema_alpha`; those curves used `ror_ema_alpha` for both rates. Bump `MEASUREMENT_ALGORITHM_VERSION` when changing the sidecar measurement algorithm. Recorded samples are the frontend polling subset; this metadata does not promise exact recomputation of every sidecar/PID read. ET/RoR visibility settings affect only the live chart and tooltip; collection and archive writing continue.


### Heater ownership and completion

`GET /status` includes `heater_control` with `connection_epoch`, `generation`,
`origin` (`manual`, `replay`, `pid`, or `safety`), `pending_writes`, `starting`,
`stopping`, and `uncertain`.
These identify command authority, not heat feedback or flame state.

`POST /control` accepts `origin: "manual" | "replay"`. Omitting origin preserves
ordinary manual control when no automatic owner is active. A manual heater edit
uses `takeover: true` to revoke automatic ownership. Fan and drum commands never
claim heater ownership. External callers cannot request PID or safety authority.
The app's Replay Drop-zero action uses a manual takeover command at logical zero;
the machine's minimum applies, and this does not confirm burner extinction.

Replay activation first reads status, then calls `POST /control/replay/claim`
with the expected `{connection_epoch, generation}`. Success returns
`{ok: true, ticket: {connection_epoch, generation, origin: "replay"}}`.
Every Replay heater write carries that exact ticket. A bounded retry also sends
`retry_epoch` and retains the original ticket. `POST /control/replay/release`
accepts the ticket and releases it after outstanding writes finish. Stale claims,
commands, retries, and releases return 409. Reacquisition requires a new explicit
activation. A delayed command cannot acquire a new generation.

All admitted writes retain their completion tasks when an HTTP waiter cancels.
S7 checks connection and generation under its I/O lock after throttling and
immediately before every physical write. Virtual and Probat check before mutation
or socket send. An already-started write may finish. A takeover acknowledges only
after older submitted work completes and its own command completes. A two-second
completion timeout returns 504 with `{error, uncertain: true}` and retains the
writer. It does not acknowledge takeover. A subsequent explicit takeover can
retry the barrier after the outstanding work finishes. Probat completion means
socket transmission, not machine confirmation.

Fixed PID endpoints and hold/zero choices remain unchanged. PID normal and final
writes use session-issued authority and the same machine limits. Reconnect
safe-off uses that same path. A superseded read or stop callback cannot write.

`timestamp` is acquisition time in monotonic seconds. The pair
`(sensor_clock, timestamp)` identifies a sample. Cache hits and stale fallback
preserve that pair; repeated samples advance neither control filtering nor PID
integration. Non-finite, future, backward, and foreign-connection observations
cannot authorize a PID update. Freshness is checked after asynchronous reads.

The session admits a PID start before waiting for earlier writes or heat feedback.
It reports `starting` during those waits. A concurrent zero stop or reset must
complete the minimum command before acknowledging the terminal transition.
Disconnect attempts that command before closing write admission. A completed
write failure retains the existing best-effort disconnect behavior. Failed or
cancelled engagement remains a visible PID fault with
terminal duty retained for an explicit zero stop or reconnect.

An unfinished PID terminal command remains `stopping` even if its HTTP caller
cancels. Cancellation or failure leaves PID faulted until a terminal command
completes or an explicit takeover replaces the operation. A later zero stop supersedes a blocked hold-feedback read and must issue
the minimum command before it acknowledges completion. An older hold cannot
restore its duty or overwrite the newer stop result.

A completed automatic safe-off retains the PID fault but does not report
`stopping`. Reconnect revokes old write authority without discarding unfinished
PID terminal duty. Manual takeover explicitly replaces that duty.

Explicit disconnect and adapter replacement close write admission and drain all
submitted writers before retiring the old connection's PID operation. A failed
minimum command cannot carry that operation onto a different adapter. An
unfinished writer prevents teardown and replacement, including after its HTTP
waiter cancels. `/connect`, `/disconnect`, and `/reset` return 504 with
`{error, uncertain: true}` when their writer barrier times out. This reports
incomplete command completion, not physical heat or flame state.
