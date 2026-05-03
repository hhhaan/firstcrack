# Artisan 로스터 하드웨어 연동 분석

## 목차
1. [아키텍처 개요](#아키텍처-개요)
2. [주요 파일 위치](#주요-파일-위치)
3. [전체 지원 디바이스 목록](#전체-지원-디바이스-목록)
4. [통신 방식별 구현](#통신-방식별-구현)
5. [드라이버 클래스 구조](#드라이버-클래스-구조)
6. [로스터 선택 및 드라이버 로드](#로스터-선택-및-드라이버-로드)
7. [온도 데이터 읽기 흐름](#온도-데이터-읽기-흐름)
8. [제어 흐름](#제어-흐름)

---

## 아키텍처 개요

**플러그인 패턴** 기반. 각 로스터/디바이스별 독립 드라이버가 `comm.py`의 `QMC` 클래스에 **콜백 함수 배열(`self.devicefunctionlist`)** 로 등록되어 통일된 인터페이스 제공.

```
UI 선택 → device 인덱스 저장 → 샘플링 루프 → self.devicefunctionlist[device] 콜백 호출 → 드라이버 → 온도 반환
```

디바이스 인덱스는 `canvas.py:799`의 `self.devices` 리스트로 정의되며, 총 **207개 인덱스** 지원.

---

## 주요 파일 위치

### 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/artisanlib/canvas.py:799` | **디바이스 마스터 목록** (`self.devices` 207개 정의) |
| `src/artisanlib/comm.py` | **중앙 통신 관리자** (`QMC` 클래스, 260KB), 콜백 함수 배열 |
| `src/artisanlib/devices.py` | **디바이스 선택 UI** (`DeviceAssignmentDlg`) |
| `src/artisanlib/main.py` | **메인 앱** (`ApplicationWindow`), 로스터 설정값 보관 |
| `src/artisanlib/async_comm.py` | **비동기 통신 기반 클래스** (`AsyncComm`, `AsyncLoopThread`) |
| `src/artisanlib/ble_port.py` | **BLE 통신 기반 클래스** (`ClientBLE`, `BLE`) |
| `src/artisanlib/modbusport.py` | **MODBUS 통신** |
| `src/artisanlib/s7port.py` | **Siemens S7 통신** |
| `src/artisanlib/wsport.py` | **WebSocket 통신** |
| `src/artisanlib/mqttport.py` | **MQTT 통신** |
| `src/artisanlib/phidgets.py` | **Phidget 디바이스 드라이버** |
| `src/artisanlib/util.py` | **온도 단위 변환 유틸** (`fromCtoFstrict` 등) |
| `src/artisanlib/sampling.py` | **샘플링 루프** |

### 로스터 전용 드라이버

| 파일 | 로스터 | 크기 |
|------|--------|------|
| `src/artisanlib/aillio_r1.py` | Aillio Bullet R1 | ~30KB |
| `src/artisanlib/aillio_r2.py` | Aillio Bullet R2 | ~41KB |
| `src/artisanlib/hottop.py` | Hottop 2K+ | ~9KB |
| `src/artisanlib/kaleido.py` | Kaleido | ~43KB |
| `src/artisanlib/santoker.py` | Santoker (WiFi/BLE) | ~23KB |
| `src/artisanlib/santoker_r.py` | Santoker R (BLE) | - |
| `src/artisanlib/orbiter.py` | Orbiter | ~31KB |
| `src/artisanlib/mugma.py` | Mugma | ~3.6KB |
| `src/artisanlib/ikawa.py` | IKAWA | - |
| `src/artisanlib/bluedot.py` | Thermoworks BlueDOT | - |
| `src/artisanlib/colortrack.py` | ColorTrack | - |
| `src/artisanlib/acaia.py` | Acaia 저울 | - |

### 파일 임포트 전용 (읽기 전용)

> ⚠️ **Loring 업데이트 (2026-05-01):** `artisanlib/loring.py`는 CSV 임포트 전용이나, Loring Smart Roast는 MODBUS TCP도 지원함이 확인됨 (`.aset` 파일 기반). `roaster_registry.py`에 `loring_smart_roast` / `loring_smart_roast_auto` 항목 추가 완료.

| 파일 | 로스터 | 포맷 |
|------|--------|------|
| `src/artisanlib/roest.py` | ROEST | MQTT/CSV |
| `src/artisanlib/loring.py` | Loring | CSV (파일 임포트) / MODBUS TCP (실시간, 별도 구현) |
| `src/artisanlib/giesen.py` | Giesen | CSV |
| `src/artisanlib/petroncini.py` | Petroncini | CSV |
| `src/artisanlib/rubasse.py` | Rubasse | CSV |
| `src/artisanlib/hibean.py` | HiBean | JSON |
| `src/artisanlib/stronghold.py` | Stronghold | XLSX |
| `src/artisanlib/cropster.py` | Cropster | XLS |
| `src/artisanlib/lebrew.py` | LeBrew | - |

---

## 전체 지원 디바이스 목록

> **정의 위치:** `src/artisanlib/canvas.py:799` (`self.devices: Final[list[str]]`)
>
> - 이름 앞에 `+` = 보조 채널 디바이스 (주 디바이스와 함께 사용)
> - 이름 앞에 `-` = 비활성/미작동 디바이스

### 로스터 전용 (실시간 연동)

| 인덱스 | 디바이스 | 통신 방식 | 제공 데이터 |
|--------|----------|----------|-------------|
| 53 | **Hottop BT/ET** | Serial/TCP | BT, ET |
| 54 | +Hottop Heater/Fan | ↑ | 히터, 팬 |
| 83 | **Aillio Bullet R1 BT/DT** | USB HID | BT, DT |
| 84 | +Aillio Bullet R1 Heater/Fan | ↑ | 히터, 팬 |
| 85 | +Aillio Bullet R1 BT RoR/Drum | ↑ | BT RoR, 드럼 |
| 86 | +Aillio Bullet R1 Voltage/Exhaust | ↑ | 전압, 배기 온도 |
| 87 | +Aillio Bullet R1 State/Fan RPM | ↑ | 상태, 팬 RPM |
| 99 | **Aillio Bullet R1 IBTS/BT** | USB HID | IBTS, BT |
| 101 | **Behmor BT/CT** | Serial | BT, CT |
| 102 | +Behmor 34 | ↑ | 추가 채널 |
| 104 | +Behmor 56 | ↑ | 추가 채널 |
| 105 | +Behmor 78 | ↑ | 추가 채널 |
| 115 | **HB BT/ET** | Serial | BT, ET |
| 116 | +HB DT/IT | ↑ | DT, IT |
| 117 | +HB AT | ↑ | AT |
| 126 | **ARC BT/ET** | Serial | BT, ET |
| 127 | +ARC MET/IT | ↑ | MET, IT |
| 128 | +ARC AT | ↑ | AT |
| 134 | **Santoker BT/ET** | WiFi/BLE | BT, ET |
| 135 | +Santoker Power/Fan | ↑ | 히터, 팬 |
| 136 | +Santoker Drum | ↑ | 드럼 |
| 138 | **Kaleido BT/ET** | WebSocket/Serial | BT, ET |
| 139 | +Kaleido SV/AT | ↑ | SV, AT |
| 140 | +Kaleido Drum/AH | ↑ | 드럼, 자동가열 |
| 141 | +Kaleido Heater/Fan | ↑ | 히터, 팬 |
| 142 | **IKAWA** | BLE | BT |
| 143 | +IKAWA SET/RPM | ↑ | 설정온도, RPM |
| 144 | +IKAWA Heater/Fan | ↑ | 히터, 팬 |
| 145 | +IKAWA State/Humidity | ↑ | 상태, 습도 |
| 160 | +IKAWA ΔHumidity/ΔHumidity Dir. | ↑ | 습도 변화율 |
| 164 | **Mugma BT/ET** | TCP | BT, ET |
| 165 | +Mugma Heater/Fan | ↑ | 히터, 팬 |
| 166 | +Mugma Heater/Catalyzer | ↑ | 히터, 촉매 |
| 167 | +Mugma SV | ↑ | 설정값 |
| 171 | **Santoker R BT/ET** | BLE (Nordic UART) | BT, ET |
| 172 | +Santoker IR/Board | ↑ | IR, 보드 온도 |
| 173 | +Santoker ΔBT/ΔET | ↑ | BT/ET RoR |
| 174 | **ColorTrack BT** | Serial | BT |
| 170 | **ColorTrack Serial** | Serial | 색상 추적 |
| 175 | **Thermoworks BlueDOT** | BLE | BT |
| 176 | **Aillio Bullet R2** | USB HID | BT, DT, IBTS 등 |
| 196 | **Orbiter BT/ET** | Serial | BT, ET |
| 197 | +Orbiter IT/DT | ↑ | IT, DT |
| 198 | +Orbiter Sound/Drum | ↑ | 사운드, 드럼 |
| 199 | +Orbiter Damper/Heater | ↑ | 댐퍼, 히터 |
| 200 | +Orbiter Air/RoR | ↑ | 에어, RoR |

### 범용 프로토콜/플랫폼

| 인덱스 | 디바이스 | 통신 방식 |
|--------|----------|----------|
| 19 | **-ARDUINOTC4** | Serial |
| 28 | +ArduinoTC4 34 | Serial |
| 32 | +ArduinoTC4 56 | Serial |
| 44 | +ArduinoTC4 78 | Serial |
| 29 | **MODBUS** | Serial/TCP |
| 33 | +MODBUS 34 | ↑ |
| 55 | +MODBUS 56 | ↑ |
| 109 | +MODBUS 78 | ↑ |
| 150 | +MODBUS 910 | ↑ |
| 79 | **S7** (Siemens) | Ethernet |
| 80 | +S7 34 | ↑ |
| 81 | +S7 56 | ↑ |
| 82 | +S7 78 | ↑ |
| 110 | +S7 910 | ↑ |
| 151 | +S7 1112 | ↑ |
| 111 | **WebSocket** | WebSocket |
| 112 | +WebSocket 34 | ↑ |
| 113 | +WebSocket 56 | ↑ |
| 118 | +WebSocket 78 | ↑ |
| 119 | +WebSocket 910 | ↑ |
| 201 | **MQTT** | MQTT |
| 202~206 | +MQTT 34/56/78/910/1112 | ↑ |
| 27 | **Program** (외부 프로그램) | 프로세스 |
| 48~49 | +Program 34/56 | ↑ |
| 88~89 | +Program 78/910 | ↑ |
| 90~91 | +Slider 01/23 | UI 슬라이더 |

### Phidget 시리즈 (USB)

| 인덱스 | 디바이스 |
|--------|----------|
| 34~36 | Phidget 1048 4xTC 01/23/AT |
| 37~38 | Phidget 1046 4xRTD 01/23 |
| 40~43 | Phidget IO 01/23/45/67 |
| 47 | Phidget 1045 IR |
| 52 | Phidget 1051 1xTC |
| 58~60 | Phidget TMP1101 4xTC 01/23/AT |
| 61 | Phidget TMP1100 1xTC |
| 62 | Phidget 1011 IO 01 |
| 63~65 | Phidget HUB IO 01/23/45 |
| 68 | Phidget TMP1200 1xRTD A |
| 69~72 | Phidget IO Digital 01/23/45/67 |
| 73 | Phidget 1011 IO Digital 01 |
| 74~76 | Phidget HUB IO Digital 01/23/45 |
| 95~98 | Phidget DAQ1400 Current/Frequency/Digital/Voltage |
| 106~107 | Phidget HUB IO 0 / HUB IO Digital 0 |
| 114 | +Phidget TMP1200 1xRTD B |
| 123~125 | Phidget VCP1000/1001/1002 |
| 137 | Phidget DAQ1500 |
| 146~149 | Phidget DAQ1000 01/23/45/67 |
| 152~153 | Phidget DAQ1200 01/23 |
| 154~155 | Phidget DAQ1300 01/23 |
| 156~159 | Phidget DAQ1301 01/23/45/67 |
| 168~169 | Phidget TMP1202 1xRTD A/B |
| 191 | +Phidget TMP1000 |
| 192 | +Phidget HUM1000 Hum/Temp |
| 193 | +Phidget PRE1000 |

### Yocto 시리즈 (USB)

| 인덱스 | 디바이스 |
|--------|----------|
| 45 | Yocto Thermocouple |
| 46 | Yocto PT100 |
| 100 | Yocto IR |
| 108 | Yocto 4-20mA Rx |
| 120 | Yocto 0-10V Rx |
| 121 | Yocto milliVolt Rx |
| 122 | Yocto Serial |
| 129 | Yocto Power |
| 130 | Yocto Energy |
| 131 | Yocto Voltage |
| 132 | Yocto Current |
| 133 | Yocto Sensor |
| 194 | +Yocto Meteo Hum/Temp |
| 195 | +Yocto Meteo Pressure |

### 온도계/멀티미터 (Serial)

| 인덱스 | 디바이스 |
|--------|----------|
| 1 | Omega HH806AU |
| 2 | Omega HH506RA |
| 3~10 | CENTER 300~309 시리즈 |
| 11~14 | VOLTCRAFT K201~K204 |
| 15 | EXTECH 421509 |
| 16 | Omega HH802U |
| 17 | Omega HH309 |
| 20 | TE VA18B |
| 23 | Omega HHM28[6] |
| 30 | VOLTCRAFT K201 |
| 31 | Amprobe TMD-56 |
| 39 | Mastech MS6514 |
| 51 | +CENTER 304 34 |
| 56 | Apollo DT301 |
| 57 | EXTECH 755 |
| 67 | VOLTCRAFT PL-125-T2 |
| 77~78 | VOLTCRAFT PL-125-T4 / 34 |
| 103 | VICTOR 86B |
| 161 | +Omega HH309 34 |
| 162 | Digi-Sense 20250-07 |
| 163 | Extech 42570 |
| 184~185 | TASI TA612C / 34 |

### 에너지/특수 장치

| 인덱스 | 디바이스 | 설명 |
|--------|----------|------|
| 179 | +Shelly 3EM Pro Energy/Return | 에너지 모니터링 |
| 180 | +Shelly Plug Energy/Last | ↑ |
| 181 | +Shelly 3EM Pro Power/S | 전력 모니터링 |
| 182 | +Shelly Plug Power/Temp | ↑ |
| 183 | +Shelly Plug Voltage/Current | 전압/전류 |
| 186 | +CM ET/BT | Cropster Monitor |
| 187~190 | +RoastSeeNEXT Agtron/Crack/RoR/FoR/Distance/Time/Yellow | 색도 측정기 |
| 177~178 | +PID P/I / +PID D/Error | PID 파라미터 표시 |

### 특수/기타

| 인덱스 | 디바이스 | 설명 |
|--------|----------|------|
| 0 | Fuji PID | (특별 처리, 목록에 미포함) |
| 18 | NONE | 수동 입력 |
| 25 | +Virtual | 가상 채널 |
| 50 | DUMMY | 더미 디바이스 |
| 22 | +PID SV/DUTY % | PID 외부 제어 |
| 26 | -DTAtemperature | 비활성 |
| 66 | -Omega HH806W | 비작동 |
| 92~94 | -Probat Middleware | 비활성 |

---

## 통신 방식별 구현

### 1. USB HID (Aillio R1/R2)

**파일:** `aillio_r1.py`, `aillio_r2.py`

```
[메인 스레드] ←─pipe─→ [워커 스레드] ←─USB─→ [Aillio 로스터]
```

- 별도 워커 스레드 + `multiprocessing.Pipe` 구조
- 폴링 주기: **0.1초**
- USB VID/PID: R1 = `0x0483/0x5741`, R2 = 다중 변형

```python
# 주요 USB 명령어 (aillio_r1.py)
AILLIO_CMD_STATUS1   = [0x30, 0x01]        # 상태 읽기 1
AILLIO_CMD_STATUS2   = [0x30, 0x03]        # 상태 읽기 2
AILLIO_CMD_HEATER_INCR = [0x34, 0x01, 0xaa, 0xaa]
AILLIO_CMD_FAN_INCR    = [0x31, 0x01, 0xaa, 0xaa]

# R2 추가 프레임
# A0_Frame: BT, ET, 히터, 팬, 드럼, RoR, 에너지
# A1_Frame: 팬 제어, 에러
# A2_Frame: 전압, 전류, 파워
```

---

### 2. 비동기 Serial/TCP (AsyncComm 기반)

**파일:** `async_comm.py`

`Hottop`, `Santoker`, `Orbiter`, `Mugma`가 모두 `AsyncComm` 상속.

```python
class AsyncComm:
    """asyncio 기반 비동기 통신"""
    # 별도 이벤트 루프 스레드(AsyncLoopThread)에서 실행
    # Serial 또는 TCP/IP 모두 지원
```

**Hottop 메시지 구조 (`hottop.py`):**
```
HEADER(2) + BODY(34) = 36 bytes
메시지[10]  → 히터 (0-100)
메시지[12]  → 메인 팬 (×10)
메시지[23:24] → ET (상위/하위 바이트)
메시지[25:26] → BT (상위/하위 바이트)
메시지[35]  → CRC 체크섬
```

**Orbiter 메시지 구조 (`orbiter.py`):**
```
HEADER: b'\xFF\xFF'
CMD_SYNC: b'\x00'
CRC 기반 이벤트 통신
채널: BT, ET, IT, DT, Air, Drum, Damper, Heater, Sound, RoR
```

**Mugma (`mugma.py`):** TCP 포트 `1504`, 라인 기반 텍스트 프로토콜

---

### 3. BLE (Bluetooth Low Energy)

**파일:** `ble_port.py`

```python
class ClientBLE:
    """Bleak 라이브러리 기반"""
    # 별도 AsyncLoopThread에서 실행
    # 스캔/연결 락으로 동시 연결 방지
    # 알림(notification) 콜백 기반

class SantokerCube_BLE(ClientBLE):
    SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
    NOTIFY_UUID  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
    WRITE_UUID   = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'

class SantokerR(ClientBLE):
    SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb'
    NOTIFY_UUID  = '0000fff5-0000-1000-8000-00805f9b34fb'
```

---

### 4. WebSocket (Kaleido)

**파일:** `kaleido.py`

```python
class KaleidoPort:
    _default_data_stream: str = 'A0'
    _open_timeout:  float = 6.0
    _ping_timeout:  float = 1.2
    _send_timeout:  float = 0.6
    _read_timeout:  float = 5.0
    # WebSocket 또는 MODBUS RTU Serial 선택 가능
```

State 딕셔너리로 데이터 관리:
```python
class State(TypedDict, total=False):
    sid: int    # 장치 상태 ID
    TU:  str    # 온도 단위
    BT:  float  # Bean Temperature
    ET:  float  # Environmental Temperature
    AT:  float  # Ambient Temperature
    TS:  float  # Target Set Temperature
    HP:  int    # Heating Power
    FC:  int    # Fan Control
    RC:  int    # Roast Control (Drum)
    AH:  int    # Auto Heating
    HS:  int    # Heating State
```

---

### 5. MODBUS (범용)

**파일:** `modbusport.py`

- Serial RTU / TCP IP 양방향 지원
- 인덱스 29, 33, 55, 109, 150 (채널 확장)
- Santoker WiFi 모드도 내부적으로 MODBUS TCP 사용 (포트 502)

---

### 6. S7 (Siemens PLC)

**파일:** `s7port.py`, `s7client.py`

- Siemens S7 시리즈 PLC 연동
- 인덱스 79~82, 110~111, 151 (최대 12채널)

---

### 7. WebSocket/MQTT (범용 데이터 수신)

**파일:** `wsport.py`, `mqttport.py`

- `WebSocket`: 인덱스 111~113, 118~119 (최대 10채널)
- `MQTT`: 인덱스 201~206 (최대 12채널)
- 외부 시스템과 범용 통합에 사용

---

## 드라이버 클래스 구조

### 클래스 상속 트리

```
AsyncComm (async_comm.py)
├── Hottop      (hottop.py)       ─ Serial/TCP, 36바이트 메시지
├── Santoker    (santoker.py)     ─ WiFi(MODBUS)/BLE
├── Orbiter     (orbiter.py)      ─ Serial, 이벤트 기반
└── Mugma       (mugma.py)        ─ TCP 라인 프로토콜

ClientBLE (ble_port.py)
├── SantokerCube_BLE (santoker.py)
└── SantokerR        (santoker_r.py)

독립 구현 (USB 멀티프로세싱)
├── AillioR1    (aillio_r1.py)
└── AillioR2    (aillio_r2.py)

독립 구현 (WebSocket)
└── KaleidoPort (kaleido.py)
```

### 주요 메서드 인터페이스 패턴

모든 로스터 드라이버는 다음 인터페이스를 구현:

```python
# 온도 읽기
def getBTET(self) -> tuple[float, float]:        # BT, ET
def getState(self) -> tuple[float, float, ...]:  # 확장 데이터

# 제어 (지원 시)
def setHeater(self, value: float) -> None
def setFan(self, value: float) -> None
def setDrum(self, value: float) -> None
```

---

## 로스터 선택 및 드라이버 로드

### UI 선택 흐름

```
devices.py: DeviceAssignmentDlg
  └── devicetypeComboBox (정렬된 디바이스 목록 표시)
      └── currentIndexChanged → deviceTypeChanged()
          └── device 인덱스 저장 → qmc.device = N
```

### Lazy 로드 패턴 (comm.py)

드라이버는 **첫 호출 시 초기화**됨:

```python
# comm.py 내 콜백 함수 예시 (Aillio R1 — comm.py:1539에서 lazy init 확인됨)
def R1_DTBT(self) -> tuple[float, float, float]:
    if self.R1 is None:                          # 첫 호출 시
        from artisanlib.aillio_r1 import AillioR1
        self.R1 = AillioR1()                     # USB 연결 시도
    # 이후 데이터 읽기 ...

# Kaleido는 comm.py가 아닌 canvas.py:13462에서 초기화됨
# comm.py의 Kaleido 콜백은 이미 생성된 인스턴스 사용:
def Kaleido_BTET(self) -> tuple[float, float, float]:
    if self.aw.kaleido is not None:              # canvas.py에서 이미 생성됨
        return self.aw.kaleido.getBTET()
    # 미연결 시 기본값 반환
```

### 콜백 배열 (comm.py: QMC.devicefunctionlist)

```python
self.devicefunctionlist: list[Callable[..., tuple[float, float, float]]] = [
    ...,
    self.R1_DTBT,          # 인덱스 83  - Aillio R1
    self.R2_BTIBTS,        # 인덱스 176 - Aillio R2
    self.hottop_BTET,      # 인덱스 53  - Hottop
    self.Santoker_BTET,    # 인덱스 134 - Santoker
    self.Kaleido_BTET,     # 인덱스 138 - Kaleido
    self.IKAWA_BTET,       # 인덱스 142 - IKAWA
    self.Mugma_BTET,       # 인덱스 164 - Mugma
    self.SantokerR_BTET,   # 인덱스 171 - Santoker R
    self.Orbiter_BTET,     # 인덱스 196 - Orbiter
    ...
]
```

---

## 온도 데이터 읽기 흐름

### 전체 흐름

```
sampling.py (주기적 실행, 기본 3초)
  └── QMC.readDev()  (comm.py)
      └── self.devicefunctionlist[qmc.device]()     ← 로스터별 콜백
          │
          ├── [Aillio]  AillioR1.get_bt()
          │             └── __getstate() → pipe.recv() ← 워커스레드(USB 폴링)
          │
          ├── [Hottop]  Hottop.getState()
          │             └── AsyncComm 스레드에서 비동기 read_msg() 수신
          │
          ├── [Kaleido] KaleidoPort.getBTET()
          │             └── send_request() → WebSocket 응답 대기
          │
          └── [BLE]     notify_callback()으로 수신된 최신값 반환
              │
              └── 반환: (timestamp, temp2, temp1)
                  └── 온도 단위 변환 (C/F)
                      └── 프로필 기록 + 그래프 업데이트
```

### Aillio R1 상세 (멀티프로세싱)

```
[워커 스레드] ──0.1초 폴링──▶ USB HID 장치
     │
     │  CMD_STATUS1 → reply(64bytes)
     │  CMD_STATUS2 → reply(64bytes)
     │
     └──pipe.send(128bytes)──▶ [메인 스레드]
                                    │
                                    └── get_bt() / get_dt() / get_heater() 등
```

### Hottop 상세 (비동기 스트림)

```
[AsyncLoopThread]
  └── asyncio StreamReader
      └── read_msg():
          ├── readuntil(0xa5)         # 헤더 첫 바이트
          ├── readexactly(1) = 0x96   # 헤더 두 번째 바이트
          ├── readexactly(34)         # 메시지 본문
          └── valid_message() → CRC 검증
              └── 파싱:
                  ET = message[23]*256 + message[24]
                  BT = message[25]*256 + message[26]
                  heater = message[10]
                  fan    = message[12] * 10
```

---

## 제어 흐름

```
사용자 UI (슬라이더/버튼)
  │
  ├── [Aillio]   AillioR1.set_heater(v) → pipe.send(CMD_HEATER_INCR/DECR)
  │                                           └── 워커스레드 → USB 전송
  │
  ├── [Hottop]   Hottop.setHottop(heater, fan)
  │              └── create_msg() → AsyncComm.send()
  │
  ├── [Kaleido]  KaleidoPort.send_request(cmd, target, var)
  │              └── WebSocket 전송
  │
  └── [Santoker] Santoker.set_*(v)
                 └── AsyncComm.send() 또는 BLE write characteristic
```

### Hottop 안전 로직

```python
BTcutoff      = 220  # 220°C 이상 → 히터 강제 OFF
BTleaveControl = 180  # 180°C 이상 → 자동 제어 모드 진입 가능
```

---

## 온도 단위 변환

**파일:** `src/artisanlib/util.py`

```python
def fromCtoFstrict(celsius: float) -> float:
    return (celsius * 9.0 / 5.0) + 32.0

def RoRfromCtoFstrict(ror_c: float) -> float:
    return ror_c * 9.0 / 5.0    # RoR은 오프셋 없이 비율만 변환

def fromFtoCstrict(fahrenheit: float) -> float:
    return (fahrenheit - 32.0) * 5.0 / 9.0
```

---

## 새 디바이스 추가 방법

코드에 `# ADD DEVICE:` 주석으로 추가해야 할 위치들이 표시되어 있음:

1. `canvas.py:799` → `self.devices` 리스트에 이름 추가
2. `canvas.py:1011` → `phidgetDevices` 또는 `nonSerialDevices` 분류
3. `comm.py` → `self.values` 배열에 콜백 함수 추가
4. 드라이버 파일 생성 (`src/artisanlib/new_device.py`)
5. `devices.py` → UI 설정 패널 추가 (포트/IP 등)
