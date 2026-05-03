# Artisanlib 기반 하드웨어 연동 구현 가이드 (최종 버전)

> **목표:** `artisanlib`을 외부 프로젝트에서 재사용하여 하드웨어 연동을 최소한의 테스트로 안전하게 구현하는 방법을 문서화한다.

---

## 1. artisanlib이 하드웨어 연동의 핵심인 이유

[`artisanlib`](src/artisanlib/__init__.py:1)은 **Artisan**이라는 커피 로스팅 소프트웨어의 핵심 라이브러리로, **20년 이상의 현장 검증**을 거친 하드웨어 연동 코드베이스다.

### artisanlib이 제공하는 것

| 계층                 | 설명                                                                          | 핵심 파일                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **통신 기반 클래스** | Serial, TCP, BLE, USB HID, WebSocket, MQTT, MODBUS, S7 등 모든 통신 방식 구현 | [`async_comm.py`](src/artisanlib/async_comm.py:1), [`ble_port.py`](src/artisanlib/ble_port.py:1), [`modbusport.py`](src/artisanlib/modbusport.py:1), [`wsport.py`](src/artisanlib/wsport.py:1), [`mqttport.py`](src/artisanlib/mqttport.py:1) |
| **로스터 드라이버**  | Aillio, Hottop, Kaleido, Santoker, IKAWA, Orbiter 등 12+ 로스터 전용 드라이버 | [`aillio_r1.py`](src/artisanlib/aillio_r1.py:1), [`hottop.py`](src/artisanlib/hottop.py:1), [`kaleido.py`](src/artisanlib/kaleido.py:1) 등                                                                                                    |
| **범용 프로토콜**    | MODBUS, WebSocket, MQTT — **드라이버 코드 없이** 설정만으로 연동 가능         | [`modbusport.py`](src/artisanlib/modbusport.py:1), [`wsport.py`](src/artisanlib/wsport.py:1), [`mqttport.py`](src/artisanlib/mqttport.py:1)                                                                                                   |
| **온도 센서**        | Phidget, Yoctopuce, Omega, CENTER, VOLTCRAFT 등 50+ 온도계/데이터 수집 장치   | [`comm.py`](src/artisanlib/comm.py:377) (`devicefunctionlist`)                                                                                                                                                                                |
| **PID 제어기**       | 산업용 PID 컨트롤러 (Fuji PXR3/PXG, DTA, PXF) 및 소프트웨어 PID               | [`pid.py`](src/artisanlib/pid.py:1), [`pid_control.py`](src/artisanlib/pid_control.py:1)                                                                                                                                                      |
| **저울 연동**        | Acaia 등 BLE 저울 프레임워크                                                  | [`scale.py`](src/artisanlib/scale.py:1)                                                                                                                                                                                                       |
| **시뮬레이터**       | 프로필 기반 가상 온도 데이터 생성                                             | [`simulator.py`](src/artisanlib/simulator.py:1)                                                                                                                                                                                               |
| **온도 단위 변환**   | C/F 변환, RoR 변환 등                                                         | [`util.py`](src/artisanlib/util.py:1)                                                                                                                                                                                                         |

---

## 2. artisanlib 계층 구조

```
┌─────────────────────────────────────────────────────┐
│                   외부 프로젝트                        │
│  (웹 앱, CLI 도구, 자동화 시스템, 모바일 백엔드 등)     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              artisanlib 공개 API 계층                  │
│  PID, Scale, Simulator, util (온도변환), atypes       │
├──────────────────────┬──────────────────────────────┤
│          devicefunctionlist (콜백 배열)                │
│   ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐ │
│   │ F0  │ F1  │ F2  │ ... │ F53 │ ... │ F196│ ... │ │
│   └──┼──┴──┼──┴──┼──┴─────┴──┼──┴─────┴──┼──┴─────┘ │
│      │     │     │           │           │           │
│   Fuji  Omega  CENTER     Hottop     Orbiter         │
│   PID   HH806 309         (AsyncComm) (AsyncComm)    │
├──────────────────────────────────────────────────────┤
│              통신 기반 클래스 계층                       │
│  AsyncComm  ClientBLE  modbusport  wsport  mqttport   │
│  (Serial/TCP)  (BLE)   (MODBUS)  (WS)   (MQTT)       │
└──────────────────────┬───────────────────────────────┘
                       │
              ┌────────┴────────┐
              │   실제 하드웨어   │
              └─────────────────┘
```

---

## 2.5 .aset 설정 파일 — 포맷은 필요 없지만, 정보는 필요하다

[`.aset`](src/includes/Machines/) 파일은 Artisan의 **QSettings 기반 INI-형식 설정 파일**이다. 100개 이상의 머신 프리셋이 [`src/includes/Machines/`](src/includes/Machines/)에 존재한다.

**.aset 파일 자체(INI 포맷)를 프로젝트에 포함시킬 필요는 없지만, .aset이 담고 있는 설정 정보는 분명히 필요하다.**

### .aset이 제공하는 정보의 가치

| .aset의 정보                                                       | 가치               | 설명                                                               |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------ |
| **`[Device] id=N`**                                                | ✅ **필수**        | 어떤 드라이버를 로드할지 결정                                      |
| **기본 통신 설정** (host, port, comport, baudrate)                 | ✅ **사용자 편의** | "이 로스터는 기본적으로 Serial 9600 8N1"이라는 정보 제공           |
| **프로토콜별 추가 설정** (S7 레지스터 맵, MODBUS 레지스터 주소 등) | ✅ **필수**        | Giesen 같은 S7 기반 머신은 레지스터 맵이 없으면 통신 자체가 불가능 |
| **PID 게인** (Kp, Ki, Kd)                                          | ✅ **가치 높음**   | 제조사가 튜닝한 최적값                                             |
| **UI 설정** (색상, 버튼, 이벤트)                                   | ❌ **불필요**      | 외부 프로젝트는 자체 UI 사용                                       |

### .aset 파일의 진정한 가치: "기본값"이 아니라 "제조사 사양"

처음에는 "host=127.0.0.1, port=80 같은 건 사용자가 항상 바꾸니까 무의미하다"고 생각했다. 하지만 다시 생각해보면:

- **Kaleido는 WebSocket, port 80이 기본** — 이 정보를 모르는 사용자는 "이 로스터가 무슨 프로토콜을 쓰는지"부터 알아내야 한다
- **Hottop은 Serial, 9600 baud, 8N1** — 이 정보가 없으면 사용자가 매뉴얼을 찾아봐야 한다
- **Giesen S7은 DB1.DBD0에 BT, DB1.DBD4에 ET** — 이 레지스터 맵이 없으면 통신 자체가 불가능하다

즉, `.aset`의 통신 설정은 **"공장 기본값"이 아니라 "제조사가 정한 프로토콜 사양"** 에 가깝다. 사용자가 IP 주소는 바꿀 수 있어도 "WebSocket을 쓴다"는 사실은 바꾸지 않는다.

### 필요한 것: .aset 파일이 아니라 .aset의 정보

```
필요한 것:                                   필요하지 않은 것:
├── 디바이스 인덱스 (id=N)                   ├── INI 파일 포맷
├── 기본 통신 방식 (Serial/TCP/WS/MQTT 등)   ├── QSettings 호환성
├── 기본 포트/보드레이트                      ├── UI 설정 (색상, 버튼)
├── 프로토콜별 추가 설정 (S7 레지스터 맵 등)  ├── 이벤트 설정
├── PID 게인                                 └── .aset 파일 100개
└── 추가 채널 설정
```

### 해결책: .aset의 정보를 ROASTER_REGISTRY에 포함

```python
ROASTER_REGISTRY = {
    'Kaleido M20': {
        'device_id': 138,
        'comm': {
            'type': 'websocket',        # 통신 방식
            'default_host': '127.0.0.1', # 기본 호스트 (사용자 변경 가능)
            'default_port': 80,          # 기본 포트 (사용자 변경 가능)
        },
        'pid': {'Kp': 15, 'Ki': 0.07, 'Kd': 0.06},
    },
    'Hottop 2K+': {
        'device_id': 53,
        'comm': {
            'type': 'serial',
            'default_comport': 'COM1',   # 기본 COM 포트
            'default_baudrate': 9600,
            'bytesize': 8,
            'parity': 'N',
            'stopbits': 1,
        },
        'pid': {'Kp': 36, 'Ki': 0.01, 'Kd': 5},
    },
    'Giesen S7': {
        'device_id': 79,
        'comm': {
            'type': 's7',
            'default_host': '192.168.0.1',
            'rack': 0,
            'slot': 2,
            'registers': {               # ← S7 레지스터 맵 (필수)
                'BT':  {'db': 1, 'offset': 0, 'type': 'real'},
                'ET':  {'db': 1, 'offset': 4, 'type': 'real'},
                'heater': {'db': 2, 'offset': 0, 'type': 'int'},
            },
        },
        'pid': None,  # Giesen은 자체 PID 사용
    },
    'Aillio Bullet R1': {
        'device_id': 83,
        'comm': {
            'type': 'usb_hid',           # USB HID — 호스트/포트 불필요
            'vid': 0x0483,
            'pid': 0x5741,
        },
        'pid': {'Kp': 20, 'Ki': 0.05, 'Kd': 2},
    },
    'MODBUS (범용)': {
        'device_id': 29,
        'comm': {
            'type': 'modbus',
            'default_host': '127.0.0.1',
            'default_port': 502,
            'default_unit_id': 1,
            'default_baudrate': 19200,
        },
        'pid': None,  # MODBUS는 외부 PID 컨트롤러 사용
    },
}
```

### 사용자 설정 UI에 기본값으로 제공

```python
# 사용자가 "Kaleido M20"을 선택하면:
selected = ROASTER_REGISTRY['Kaleido M20']

# UI에 기본값을 자동으로 채워줌
ui.host_input.setText(selected['comm']['default_host'])   # "127.0.0.1"
ui.port_input.setText(str(selected['comm']['default_port']))  # "80"
ui.comm_type_label.setText(selected['comm']['type'])      # "WebSocket"

# 사용자는 필요시 수정 가능
# → 대부분의 경우 기본값 그대로 사용
```

### 결론: .aset 파일 자체는 필요 없지만, .aset의 정보는 ROASTER_REGISTRY에 포함해야 한다

| 구분             | 내용                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| **필요 없는 것** | `.aset` INI 파일 100개, QSettings 호환성, UI 설정                                       |
| **필요한 것**    | 각 로스터의 **통신 방식, 기본 포트, 프로토콜별 추가 설정(S7 레지스터 맵 등), PID 게인** |
| **방법**         | 위 정보를 `ROASTER_REGISTRY`에 JSON 형태로 포함                                         |
| **효과**         | 사용자는 로스터만 선택하면 통신 설정이 자동으로 채워짐                                  |

---

## 2.6 다양한 로스터 지원 프로젝트를 위한 아키텍처

> **당신의 프로젝트가 여러 로스터기를 지원해야 한다면, artisanlib은 이미 이 문제를 해결한 아키텍처를 제공한다.**

### artisanlib의 멀티-로스터 아키텍처

artisanlib의 [`devicefunctionlist`](src/artisanlib/comm.py:377)는 **207개 디바이스를 단일 인터페이스로 추상화**한다:

```python
# 모든 드라이버의 공통 인터페이스
devicefunctionlist[device_id]() → (timestamp: float, temp1: float, temp2: float)
```

즉, **`device_id` 값 하나만 바꾸면 다른 로스터로 전환**된다. 드라이버 코드는 전혀 건드릴 필요가 없다.

```
당신의 프로젝트 구조:

┌─────────────────────────────────────────────┐
│              사용자 설정 UI                    │
│  "어떤 로스터를 사용하시겠습니까?"              │
│  ┌─────────────────────────────────────────┐ │
│  │ ▼ Hottop 2K+          (device_id=53)   │ │
│  │   Aillio Bullet R1    (device_id=83)   │ │
│  │   Kaleido M20         (device_id=138)  │ │
│  │   Santoker            (device_id=134)  │ │
│  │   Orbiter             (device_id=196)  │ │
│  │   Giesen S7           (device_id=79)   │ │
│  │   MODBUS (범용)       (device_id=29)   │ │
│  │   MQTT (범용)         (device_id=201)  │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────┘
                       │ device_id = 53
┌──────────────────────▼──────────────────────┐
│         artisanlib.devicefunctionlist         │
│  self.values[53]() → Hottop 드라이버 자동 로드 │
└──────────────────────┬──────────────────────┘
                       │ (timestamp, BT, ET)
┌──────────────────────▼──────────────────────┐
│          당신의 프로젝트 코어 로직              │
│  (온도 기록, PID 제어, 알림, 분석 등)          │
└─────────────────────────────────────────────┘
```

### 설정만으로 로스터 추가/변경

```python
# config.json — 사용자가 로스터를 선택하면 device_id만 저장
{
  "device_id": 53,              # Hottop
  "connection": {
    "comport": "COM3",          # 사용자 환경에 맞게 입력
    "baudrate": 9600
  },
  "pid": {
    "Kp": 36, "Ki": 0.01, "Kd": 5  # Hottop 전용 PID 게인
  }
}
```

```python
# 프로젝트 코드 — device_id만으로 모든 로스터 지원
class RoasterManager:
    def __init__(self, config: dict):
        self.device_id = config['device_id']
        # device_id에 따라 artisanlib이 자동으로 올바른 드라이버 로드
        # (실제로는 QMC 인스턴스에서 devicefunctionlist 호출)

    def read_temperatures(self) -> tuple[float, float]:
        """로스터 종류와 무관하게 동일한 인터페이스"""
        # self.device_id에 따라 artisanlib 내부에서
        # Hottop / Aillio / Kaleido / Santoker 등
        # 각각의 드라이버가 자동으로 선택되어 호출됨
        timestamp, bt, et = devicefunctionlist[self.device_id]()
        return bt, et
```

### 새 로스터 추가 = 레지스트리에 한 줄 추가

```python
# 새 로스터를 지원하려면 레지스트리 매핑만 추가하면 됨
ROASTER_REGISTRY = {
    # key: 사용자에게 표시할 이름 → value: 설정 정보
    'Hottop 2K+': {
        'device_id': 53,
        'comm': {'type': 'serial', 'default_baudrate': 9600},
        'pid': {'Kp': 36, 'Ki': 0.01, 'Kd': 5},
    },
    'Kaleido M20': {
        'device_id': 138,
        'comm': {'type': 'websocket', 'default_host': '127.0.0.1', 'default_port': 80},
        'pid': {'Kp': 15, 'Ki': 0.07, 'Kd': 0.06},
    },
    'Giesen S7': {
        'device_id': 79,
        'comm': {
            'type': 's7',
            'default_host': '192.168.0.1',
            'rack': 0, 'slot': 2,
            'registers': {
                'BT': {'db': 1, 'offset': 0, 'type': 'real'},
                'ET': {'db': 1, 'offset': 4, 'type': 'real'},
            },
        },
        'pid': None,  # 자체 PID 사용
    },
    # ↑ 새 로스터 추가는 여기에 추가
}
```

### 이 아키텍처의 장점

| 항목                | 전통적인 방식                   | artisanlib 기반 방식                   |
| ------------------- | ------------------------------- | -------------------------------------- |
| **로스터 추가**     | 드라이버를 처음부터 구현        | `ROASTER_REGISTRY`에 설정 한 블록 추가 |
| **드라이버 코드**   | 로스터마다 별도 구현            | artisanlib에 이미 있음 (0줄 작성)      |
| **통신 방식**       | Serial/TCP/BLE/USB 각각 구현    | artisanlib이 자동 처리                 |
| **프로토콜별 설정** | S7 레지스터 맵 등을 별도 관리   | 레지스트리에 포함                      |
| **사용자 편의**     | 매번 모든 설정 입력             | 로스터 선택만 하면 기본값 자동 채움    |
| **테스트**          | 로스터마다 E2E 테스트 필요      | Simulator로 일괄 테스트 가능           |
| **유지보수**        | 로스터 펌웨어 변경 시 직접 대응 | artisanlib 업데이트로 자동 대응        |

### 실제 통합 예: 10개 로스터 지원 프로젝트

```python
# 10개 로스터를 지원하는 프로젝트의 전체 코드량
# ─────────────────────────────────────────
# artisanlib (서브모듈):    0줄 작성 (이미 존재)
# ROASTER_REGISTRY:         ~150줄 (설정 정보)
# 설정 UI:                  50줄 (로스터 선택 콤보박스)
# 연결 로직:                30줄 (설정 → artisanlib 연결)
# ─────────────────────────────────────────
# 총 작성 코드:             ~230줄
# 지원 로스터:              10개
# 사용자 경험:              로스터 선택만 하면 끝
```

> **결론:** 다양한 로스터를 지원해야 하는 프로젝트일수록 **artisanlib의 `devicefunctionlist` 아키텍처가 더 큰 가치**를 발휘한다. 로스터 추가 = `ROASTER_REGISTRY`에 설정 블록 하나 추가일 뿐, 드라이버 코드는 단 한 줄도 작성할 필요가 없다. `.aset` 파일 자체는 필요 없지만, `.aset`이 담고 있는 **통신 설정 정보**는 `ROASTER_REGISTRY`에 포함시켜 사용자 편의를 제공해야 한다.

---

## 3. 다른 프로젝트에서 artisanlib 활용하는 5가지 방법

### 방법 A: 범용 프로토콜 사용 (테스트 불필요)

**MODBUS, WebSocket, MQTT**는 **드라이버 코드를 전혀 작성하지 않고** 설정만으로 하드웨어와 통신할 수 있다.

```python
# MODBUS 예제 — 설정만으로 연동 완료
from pymodbus.client import AsyncModbusTcpClient  # pymodbus 라이브러리에서 직접 import

# MODBUS TCP로 온도 읽기
client = AsyncModbusTcpClient('192.168.1.100', port=502)
await client.connect()
result = await client.read_holding_registers(0x0000, 2, slave=1)
temperature = result.registers[0] / 10.0  # 스케일링
```

```python
# MQTT 예제 — 토픽 구독만으로 데이터 수신
from artisanlib.mqttport import mqttport

# mqttport는 브로커 연결, 토픽 구독, jmespath 파싱까지 자동 처리
# 설정만으로 12개 채널까지 확장 가능
port = mqttport(aw)
port.host = 'mqtt-broker.local'
port.topic = 'roaster/#'  # 모든 로스터 데이터 구독
```

```python
# WebSocket 예제
from artisanlib.wsport import wsport

port = wsport(aw)
port.host = '192.168.1.50'
port.port = 8080
port.path = '/ws/data'
# 10개 채널 자동 매핑
```

> **✅ 테스트 전략:** MODBUS/WebSocket/MQTT는 이미 artisanlib 내에서 광범위하게 테스트됨. 외부 프로젝트에서는 **JSON 설정 파일**만 관리하면 된다.

---

### 방법 B: AsyncComm 상속 (Serial/TCP 디바이스)

새로운 Serial 또는 TCP 기반 디바이스를 추가할 때는 [`AsyncComm`](src/artisanlib/async_comm.py:252)을 상속받아 **프로토콜 파싱만** 구현한다.

```python
from artisanlib.async_comm import AsyncComm

class MyCustomRoaster(AsyncComm):
    """내 커스텀 로스터 드라이버 — 프로토콜 파싱만 구현"""

    # 프로토콜 상수
    HEADER = b'\xA5\x96'
    MSG_LEN = 36

    async def read_msg(self) -> tuple[float, float]:
        """하드웨어에서 메시지를 읽고 BT, ET 온도 반환"""
        data = await self._reader.readuntil(self.HEADER)
        data += await self._reader.readexactly(self.MSG_LEN)

        # 프로토콜 파싱 (예: Hottop 스타일)
        et = (data[23] * 256 + data[24]) / 10.0
        bt = (data[25] * 256 + data[26]) / 10.0
        return bt, et

    def getBTET(self) -> tuple[float, float]:
        """QMC.devicefunctionlist 콜백 규약 준수"""
        return self.getState()  # 최신 캐시된 값 반환
```

> **✅ 테스트 전략:** [`AsyncComm`](src/artisanlib/async_comm.py:252)의 `AsyncLoopThread`는 이미 검증됨. `read_msg()`만 단위 테스트하면 된다. 실제 하드웨어 없이도 `asyncio.StreamReader`에 가상 데이터를 주입하여 테스트 가능.

---

### 방법 C: BLE 상속 (Bluetooth Low Energy 디바이스)

BLE 디바이스는 [`ClientBLE`](src/artisanlib/ble_port.py:244)를 상속받아 **Service UUID와 Notify/Write characteristic만** 정의한다.

```python
from artisanlib.ble_port import ClientBLE

class MyBLESensor(ClientBLE):
    """BLE 온도 센서 — UUID와 파싱만 구현"""

    SERVICE_UUID = '00001809-0000-1000-8000-00805f9b34fb'
    NOTIFY_UUID  = '00002a1c-0000-1000-8000-00805f9b34fb'
    WRITE_UUID   = None  # 읽기 전용

    def notification_handler(self, characteristic, data: bytearray) -> None:
        """BLE 알림 콜백 — 온도 파싱"""
        # IEEE 11073 Temperature Measurement 형식 파싱
        temp = int.from_bytes(data[2:4], byteorder='little', signed=True) / 100.0
        self._last_temp = temp

    def get_temperature(self) -> float:
        return self._last_temp
```

> **✅ 테스트 전략:** [`BLE`](src/artisanlib/ble_port.py:42) 클래스의 스캔/연결/락 관리 로직은 이미 검증됨. `notification_handler()`만 단위 테스트. Bleak의 `BleakClient`를 Mocking하여 하드웨어 없이 테스트 가능.

---

### 방법 D: PID 제어기만 독립 사용

[`PID`](src/artisanlib/pid.py:75) 클래스는 **Qt 의존성을 Mocking하면** 완전히 독립적으로 사용 가능하다. 이미 [`test_pid_uat.py`](src/test/uat/artisanlib/test_pid_uat.py:1)에서 검증된 패턴.

```python
# PyQt6 Mocking (test_pid_uat.py의 패턴 재사용)
from unittest.mock import Mock, patch
import numpy as np

mock_modules = {
    'PyQt6': Mock(),
    'PyQt6.QtCore': Mock(),
    'PyQt6.QtWidgets': Mock(),
    'PyQt6.QtGui': Mock(),
    'PyQt6.sip': Mock(),
    'scipy': Mock(),
    'scipy.signal': Mock(),
    'artisanlib.filters': Mock(),
}

# Mock QSemaphore
class MockQSemaphore:
    def __init__(self, n=1):
        self.acquire = Mock()
        self.release = Mock()
        self.available = Mock(return_value=n)

mock_modules['PyQt6.QtCore'].QSemaphore = MockQSemaphore
mock_modules['scipy.signal'].iirfilter = Mock(
    return_value=np.array([[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]])
)

with patch.dict('sys.modules', mock_modules, clear=False):
    from artisanlib.pid import PID

# PID 제어기 생성 및 사용
pid = PID(
    outMin=0, outMax=100,     # 히터 출력 0~100%
    Kp=25, Ki=0.2, Kd=0.5,   # PID 게인
    control=lambda v: print(f"히터 출력: {v}%")  # 실제 제어 함수
)

pid.target = 200.0  # 목표 온도 200°C
pid.update(25.0, 195.0)  # 현재 온도 195°C → 출력 계산
print(f"PID 출력: {pid.lastOutput}")  # 히터 출력값
```

> **✅ 테스트 전략:** 위 Mocking 패턴을 그대로 재사용. [`test_pid_uat.py`](src/test/uat/artisanlib/test_pid_uat.py:1)의 1851라인 테스트 스위트가 이미 모든 엣지 케이스를 검증. 외부 프로젝트에서는 **PID 게인 튜닝만** 테스트하면 됨.

---

### 방법 E: Simulator로 하드웨어 없이 개발

[`Simulator`](src/artisanlib/simulator.py:32) 클래스를 사용하면 **실제 하드웨어 없이** 프로필 기반 가상 온도 데이터로 전체 파이프라인을 개발/테스트할 수 있다.

```python
from artisanlib.simulator import Simulator

# 기존 로스팅 프로필 로드
profile = {
    'timex': [0, 60, 120, 180, 240, 300, 360, 420, 480],
    'temp1': [25, 80, 130, 170, 195, 205, 210, 212, 215],  # BT
    'temp2': [25, 120, 180, 210, 220, 225, 228, 230, 232], # ET
    'mode': 'C',
}

sim = Simulator(mode='C', profile=profile)

# 시간에 따른 온도 시뮬레이션
for t in range(0, 500, 10):
    bt = sim.get_temp1(t)  # 보간된 BT
    et = sim.get_temp2(t)  # 보간된 ET
    print(f"t={t}s: BT={bt:.1f}°C, ET={et:.1f}°C")
```

> **✅ 테스트 전략:** 시뮬레이터로 **전체 통합 테스트를 하드웨어 없이** 수행. 프로필 데이터만 있으면 실제 로스팅과 동일한 온도 곡선으로 테스트 가능.

---

## 4. 테스트 최소화 전략 — 계층별 접근

### 핵심 원칙: "이미 검증된 것은 다시 테스트하지 않는다"

```
테스트 필요성:  방법A < 방법B < 방법C < 방법D < 방법E
(범용프로토콜)                    (신규드라이버)
```

### 계층별 테스트 전략 매트릭스

| 계층                                                                          | artisanlib 내 검증 상태           | 외부 프로젝트 테스트                 |
| ----------------------------------------------------------------------------- | --------------------------------- | ------------------------------------ |
| **통신 기반 클래스** (`AsyncComm`, `BLE`, `modbusport`, `wsport`, `mqttport`) | ✅ 완전 검증됨 (수년간 현장 사용) | **테스트 불필요**                    |
| **온도 단위 변환** (`util.py`)                                                | ✅ 완전 검증됨                    | **테스트 불필요**                    |
| **PID 제어기** (`pid.py`)                                                     | ✅ UAT 1851라인 테스트 스위트     | **게인 튜닝만 테스트**               |
| **Simulator** (`simulator.py`)                                                | ✅ 완전 검증됨                    | **테스트 불필요**                    |
| **프로토콜 파싱** (신규 드라이버의 `read_msg` 등)                             | ❌ 신규 코드                      | **단위 테스트 필요** (Mock 기반)     |
| **설정/연결** (IP, 포트, UUID 등)                                             | ❌ 환경 의존                      | **통합 테스트 1회** (실제 연결 확인) |

### 권장 테스트 피라미드

```
        ┌──────────┐
        │  E2E 1~2  │  ← 실제 하드웨어 연결 확인 (1~2회)
       ┌┴──────────┴┐
       │ 통합 3~5   │  ← Simulator + 전체 파이프라인
      ┌┴────────────┴┐
      │  단위 10~20  │  ← 프로토콜 파싱, 설정 검증
     ┌┴──────────────┴┐
     │  Zero          │  ← artisanlib 검증된 코드는 테스트 제로
     └────────────────┘
```

---

## 5. 단계별 구현 가이드

### Step 1: 연결 방식 결정

```
하드웨어의 통신 방식은?
│
├── MODBUS/TCP or RTU → 방법 A (설정만)
├── MQTT → 방법 A (설정만)
├── WebSocket → 방법 A (설정만)
├── Serial/TCP (커스텀 프로토콜) → 방법 B (AsyncComm 상속)
├── BLE (커스텀) → 방법 C (ClientBLE 상속)
├── PID 제어만 필요 → 방법 D (PID 독립 사용)
└── 개발/테스트용 가상 → 방법 E (Simulator)
```

### Step 2: 최소 구현

```python
# 최소 구현 예: AsyncComm 기반 드라이버
from artisanlib.async_comm import AsyncComm

class MinimalDriver(AsyncComm):
    """최소한의 드라이버 — 프로토콜 파싱만"""

    async def read_msg(self) -> tuple[float, float]:
        """하드웨어에서 데이터 읽기"""
        line = await self._reader.readline()
        parts = line.decode().strip().split(',')
        return float(parts[0]), float(parts[1])  # BT, ET

    def getBTET(self) -> tuple[float, float]:
        return self.getState()
```

### Step 3: Simulator로 통합 테스트

```python
# Simulator로 전체 파이프라인 검증
sim = Simulator(mode='C', profile=profile)

class SimulatedDriver:
    """실제 드라이버 대신 Simulator 사용"""
    def getBTET(self):
        t = current_time  # 실제 시간 또는 가상 시간
        return sim.get_temp1(t), sim.get_temp2(t)

# 프로덕션 코드는 Driver 인터페이스에 의존
driver = SimulatedDriver() if testing else RealDriver()
bt, et = driver.getBTET()
```

### Step 4: 실제 하드웨어 연결 확인 (1회)

```python
# 단 1회의 E2E 테스트로 연결 확인
driver = RealDriver(host='192.168.1.100', port=5000)
await driver.connect()
bt, et = await driver.read_msg()
assert 0 < bt < 300  # 정상 범위 확인
assert 0 < et < 300
print(f"✅ 연결 성공: BT={bt}°C, ET={et}°C")
```

---

## 6. artisanlib 핵심 API 레퍼런스

### 통신 기반 클래스

| 클래스                                               | 파일            | 용도                              | 상속 시 구현할 메서드     |
| ---------------------------------------------------- | --------------- | --------------------------------- | ------------------------- |
| [`AsyncComm`](src/artisanlib/async_comm.py:252)      | `async_comm.py` | Serial/TCP 비동기 통신            | `read_msg()` → `(bt, et)` |
| [`AsyncLoopThread`](src/artisanlib/async_comm.py:41) | `async_comm.py` | 별도 스레드에서 asyncio 루프 실행 | (직접 사용)               |
| [`BLE`](src/artisanlib/ble_port.py:42)               | `ble_port.py`   | BLE 스캔/연결 관리                | (상속용 기반 클래스)      |
| [`ClientBLE`](src/artisanlib/ble_port.py:244)        | `ble_port.py`   | BLE 클라이언트                    | `notification_handler()`  |
| [`modbusport`](src/artisanlib/modbusport.py:87)      | `modbusport.py` | MODBUS Serial/TCP                 | (설정만)                  |
| [`wsport`](src/artisanlib/wsport.py:41)              | `wsport.py`     | WebSocket 클라이언트              | (설정만)                  |
| [`mqttport`](src/artisanlib/mqttport.py:39)          | `mqttport.py`   | MQTT 클라이언트                   | (설정만)                  |

### 독립 사용 가능한 클래스

| 클래스                                        | 파일                                  | 용도               | Qt 의존성         |
| --------------------------------------------- | ------------------------------------- | ------------------ | ----------------- |
| [`PID`](src/artisanlib/pid.py:75)             | `pid.py`                              | PID 제어기         | ✅ (Mocking 가능) |
| [`Simulator`](src/artisanlib/simulator.py:32) | `simulator.py`                        | 온도 시뮬레이터    | ❌ (의존성 없음)  |
| [`Scale`](src/artisanlib/scale.py:76)         | `scale.py`                            | 저울 프레임워크    | ✅ (Mocking 가능) |
| 온도 변환 함수들                              | [`util.py`](src/artisanlib/util.py:1) | C/F 변환, RoR 변환 | ❌ (의존성 없음)  |

### devicefunctionlist 콜백 규약

[`comm.py`](src/artisanlib/comm.py:377)의 `devicefunctionlist`는 모든 드라이버가 다음 시그니처를 따르도록 강제한다:

```python
# 모든 드라이버 콜백의 공통 시그니처
Callable[..., tuple[float, float, float]]
# 반환값: (timestamp, temperature1, temperature2)
# - timestamp: Unix epoch 시간 (float)
# - temperature1: 주 채널 온도 (BT 등)
# - temperature2: 보조 채널 온도 (ET 등)
```

---

## 7. 실제 사용 예: 외부 프로젝트 통합

### 예: 웹 기반 로스팅 모니터

```python
# 1. pymodbus의 AsyncModbusTcpClient로 온도 수집
from pymodbus.client import AsyncModbusTcpClient

class RoastingMonitor:
    def __init__(self, host: str):
        self.client = AsyncModbusTcpClient(host, port=502)

    async def get_temperatures(self) -> dict:
        await self.client.connect()
        result = await self.client.read_holding_registers(0, 4, slave=1)
        return {
            'bt': result.registers[0] / 10.0,
            'et': result.registers[1] / 10.0,
        }

# 2. artisanlib의 PID로 제어
from artisanlib.pid import PID  # Qt Mocking 필요

pid = PID(outMin=0, outMax=100, Kp=20, Ki=0.15, Kd=0.3,
          control=lambda v: modbus_write_heater(v))

# 3. artisanlib의 Simulator로 테스트
from artisanlib.simulator import Simulator

sim = Simulator(mode='C', profile=load_profile('profile.json'))
for t in range(0, 600, 3):
    bt, et = sim.get_temp1(t), sim.get_temp2(t)
    pid.update(t, bt)
```

### 예: CLI 도구

```python
#!/usr/bin/env python3
"""간단한 온도 모니터링 CLI — pymodbus 직접 사용"""

import asyncio
from pymodbus.client import AsyncModbusTcpClient

async def monitor(host: str):
    client = AsyncModbusTcpClient(host, port=502)
    await client.connect()
    while True:
        result = await client.read_holding_registers(0, 2, slave=1)
        bt = result.registers[0] / 10.0
        et = result.registers[1] / 10.0
        print(f"BT: {bt:.1f}°C  ET: {et:.1f}°C")
        await asyncio.sleep(3)

if __name__ == '__main__':
    asyncio.run(monitor('192.168.1.100'))
```

---

## 8. PyQt6 의존성 제거 — 외부 프로젝트에서 실제로 import하는 방법

> **당신의 프로젝트는 독자적인 UI/UX를 가진 프로젝트다. PyQt6는 필요하지 않다.**
>
> 다행히 **artisanlib의 핵심 드라이버 파일들은 대부분 PyQt6가 필요 없다.** 아래 분석을 참고하여 필요한 모듈만 선별적으로 가져가라.

### 8.1 artisanlib 모듈별 PyQt6 의존성 분석

#### ✅ PyQt6 의존성이 전혀 없는 모듈 (그대로 import 가능)

| 모듈                                              | 용도                               | import 방법                                                    |
| ------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| [`async_comm.py`](src/artisanlib/async_comm.py:252) | Serial/TCP 비동기 통신 기반 클래스 | `from artisanlib.async_comm import AsyncComm`                  |
| [`simulator.py`](src/artisanlib/simulator.py:32)  | 온도 시뮬레이터                    | `from artisanlib.simulator import Simulator`                   |
| [`hottop.py`](src/artisanlib/hottop.py:1)         | Hottop 로스터 드라이버             | `from artisanlib.hottop import Hottop`                         |
| [`kaleido.py`](src/artisanlib/kaleido.py:1)       | Kaleido 로스터 드라이버            | `from artisanlib.kaleido import KaleidoPort`                   |
| [`aillio_r1.py`](src/artisanlib/aillio_r1.py:1)   | Aillio R1 드라이버                 | `from artisanlib.aillio_r1 import AillioR1`                    |
| [`aillio_r2.py`](src/artisanlib/aillio_r2.py:1)   | Aillio R2 드라이버                 | `from artisanlib.aillio_r2 import AillioR2`                    |
| [`santoker.py`](src/artisanlib/santoker.py:1)     | Santoker 드라이버                  | `from artisanlib.santoker import Santoker`                     |
| [`santoker_r.py`](src/artisanlib/santoker_r.py:1) | Santoker R 드라이버                | `from artisanlib.santoker_r import SantokerR`                  |
| [`mugma.py`](src/artisanlib/mugma.py:1)           | Mugma 드라이버                     | `from artisanlib.mugma import Mugma`                           |
| [`bluedot.py`](src/artisanlib/bluedot.py:1)       | BlueDOT 온도계                     | `from artisanlib.bluedot import BlueDOT`                       |
| [`colortrack.py`](src/artisanlib/colortrack.py:1) | ColorTrack                         | `from artisanlib.colortrack import ColorTrack`                 |
| [`ikawa.py`](src/artisanlib/ikawa.py:1)           | IKAWA 로스터                       | `from artisanlib.ikawa import Ikawa`                           |
| [`pid.py`](src/artisanlib/pid.py:75)              | PID 제어기                         | `from artisanlib.pid import PID` (QSemaphore → threading.Lock) |
| [`filters.py`](src/artisanlib/filters.py:1)       | 신호 필터                          | `from artisanlib.filters import LiveSosFilter`                 |
| [`atypes.py`](src/artisanlib/atypes.py:1)         | 데이터 타입                        | `from artisanlib.atypes import ProfileData`                    |

> **총 15개 모듈** — PyQt6 없이 그대로 import해서 사용 가능하다.

#### ⚠️ PyQt6 의존성이 얕은 모듈 (포크 필요)

| 모듈                                              | Qt 의존성                                                     | 대체 방법                                         |
| ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| [`orbiter.py`](src/artisanlib/orbiter.py:1)       | `Qt`, `QDateTime`, `QDate`, `QTime`, `QApplication.translate` | QDateTime → `datetime`, `translate` 제거          |
| [`modbusport.py`](src/artisanlib/modbusport.py:87) | `QSemaphore`, `QApplication.translate`                        | `QSemaphore` → `threading.Lock`, `translate` 제거 |
| [`wsport.py`](src/artisanlib/wsport.py:41)        | `QApplication.translate`                                      | `translate` 호출 제거                             |
| [`mqttport.py`](src/artisanlib/mqttport.py:39)    | `QApplication.translate`                                      | `translate` 호출 제거                             |
| [`ble_port.py`](src/artisanlib/ble_port.py:1)     | `QObject` (`ClientBLE`가 상속)                                | `from PyQt6.QtCore import QObject` 삭제 + `class ClientBLE(QObject):` → `class ClientBLE:` 변경 |
| [`s7port.py`](src/artisanlib/s7port.py:1)         | `QSemaphore`, `QApplication.translate`                        | `QSemaphore` → `threading.Lock`, `translate` 제거 |

#### ❌ PyQt6 의존성이 깊은 모듈 (사용 불가 — artisanlib UI 전용)

| 모듈                                        | 이유                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`comm.py`](src/artisanlib/comm.py:1)       | `serialport` 클래스가 Qt 위젯, 시그널, 세마포어에 깊게 의존                          |
| [`canvas.py`](src/artisanlib/canvas.py:1)   | 그래프 그리기, Qt 이벤트 처리                                                        |
| [`devices.py`](src/artisanlib/devices.py:1) | 디바이스 설정 UI 다이얼로그                                                          |
| [`main.py`](src/artisanlib/main.py:1)       | Artisan 메인 윈도우 — 전체 Qt 앱                                                     |
| [`dialogs.py`](src/artisanlib/dialogs.py:1) | 각종 UI 다이얼로그                                                                   |
| [`ports.py`](src/artisanlib/ports.py:1)     | 포트 설정 UI                                                                         |
| [`scale.py`](src/artisanlib/scale.py:1)     | `QObject`, `pyqtSignal`, `QTimer` — Qt 이벤트 기반                                   |
| [`util.py`](src/artisanlib/util.py:1)       | Qt import가 있지만 **온도 변환 함수는 순수 Python** — 함수 단위로 선택적 import 가능 |

### 8.2 핵심 발견: 드라이버 파일에는 PyQt6가 없다

가장 중요한 발견: **실제 하드웨어 드라이버 파일들은 PyQt6를 전혀 import하지 않는다.**

```
드라이버 파일         Qt import 수
─────────────────────────────────────
hottop.py            0개 ✅
kaleido.py           0개 ✅
aillio_r1.py         0개 ✅
aillio_r2.py         0개 ✅
santoker.py          0개 ✅
santoker_r.py        0개 ✅
async_comm.py        0개 ✅ (기반 클래스)
simulator.py         0개 ✅
filters.py           0개 ✅
orbiter.py           2개 ⚠️ (QDateTime 날짜파싱, QApplication.translate)
```

대부분의 로스터 드라이버는 **순수 Python 통신 로직**이며, PyQt6는 Artisan의 UI 레이어에서 주로 사용된다. `orbiter.py`는 예외적으로 날짜 파싱(`QDateTime`)과 제목 번역(`QApplication.translate`)에 Qt를 사용하므로 포크 시 `datetime`으로 교체가 필요하다.

### 8.3 모듈별 Qt 제거 및 import 예제

#### 예제 1: async_comm.py — Qt 의존성 없음, 그대로 사용

```python
# async_comm.py는 PyQt6를 전혀 사용하지 않음
# asyncio + pyserial + pymodbus만 사용
from artisanlib.async_comm import AsyncComm, AsyncLoopThread

class MyDriver(AsyncComm):
    """AsyncComm 상속 — Qt 전혀 없음"""
    async def read_msg(self):
        data = await self._reader.readuntil(b'\n')
        return float(data.strip())

# AsyncLoopThread — 별도 스레드에서 asyncio 루프 실행
loop_thread = AsyncLoopThread()
# loop_thread.loop → asyncio event loop
```

#### 예제 2: pid.py — QSemaphore를 threading.Lock으로 대체

```python
# PID 클래스는 QSemaphore 하나만 사용
# → threading.Lock으로 3줄만 변경하면 됨

# artisanlib/pid.py의 원본:
#   from PyQt6.QtCore import QSemaphore
#   self.pidSemaphore = QSemaphore(1)
#   self.pidSemaphore.acquire()
#   self.pidSemaphore.release()

# 변경 후:
import threading
#   self.pidSemaphore = threading.Lock()  # QSemaphore(1) → Lock()
#   self.pidSemaphore.acquire()           # 그대로 사용 가능 (Lock에도 acquire() 있음)
#   self.pidSemaphore.release()           # 그대로 사용 가능

# 실제 사용
from artisanlib.pid import PID  # 위 패치 적용 후

pid = PID(outMin=0, outMax=100, Kp=25, Ki=0.2, Kd=0.5,
          control=lambda v: print(f"Heater: {v}%"))
pid.target = 200.0
pid.update(25.0, 195.0)
```

#### 예제 3: ble_port.py — QObject import 제거 + ClientBLE 클래스 선언 수정

```python
# ble_port.py에서 수정할 부분은 두 곳:

# 변경 1: import 줄 삭제
#   from PyQt6.QtCore import QObject  ← 이 줄 삭제

# 변경 2: ClientBLE 클래스 선언 수정
#   class ClientBLE(QObject):  ← QObject 상속 제거
#   →
#   class ClientBLE:

# BLE 클래스(line 42)는 QObject를 상속하지 않으므로 수정 불필요

from artisanlib.ble_port import BLE, ClientBLE  # 위 두 곳 수정 후 정상 동작
```

#### 예제 4: modbusport.py — QSemaphore → threading.Lock

```python
# modbusport.py는 QSemaphore 1개 + QApplication.translate()만 사용

# 변경 전:
#   from PyQt6.QtCore import QSemaphore
#   from PyQt6.QtWidgets import QApplication
#   self.modbusSemaphore = QSemaphore(1)
#   QApplication.translate('Button', 'Scan Modbus')

# 변경 후:
import threading
#   self.modbusSemaphore = threading.Lock()
#   'Scan Modbus'  # translate() 제거, 문자열 직접 사용

from artisanlib.modbusport import modbusport  # 위 패치 적용 후 정상 동작
```

#### 예제 5: wsport.py / mqttport.py — QApplication.translate()만 제거

```python
# wsport.py와 mqttport.py는 QApplication.translate()만 사용
# translate()는 다국어 지원용 — 제거해도 통신 로직에 영향 없음

# 변경 전:
#   from PyQt6.QtWidgets import QApplication
#   label = QApplication.translate('Label', 'Host')

# 변경 후:
#   from PyQt6.QtWidgets import QApplication  ← 이 줄 삭제
#   label = 'Host'  # 문자열 직접 사용

from artisanlib.wsport import wsport
from artisanlib.mqttport import mqttport
```

### 8.4 권장: 포크 전략

PyQt6 의존성을 제거하는 가장 실용적인 방법:

```
1. artisanlib을 Git submodule로 추가
2. 포크할 파일만 복사하여 PyQt6 import 제거
3. 나머지는 원본 그대로 사용
```

```bash
# 1. artisanlib을 submodule로 추가
git submodule add https://github.com/artisan-roaster-scope/artisanlib.git lib/artisanlib

# 2. PyQt6 제거가 필요한 파일만 포크
cp lib/artisanlib/artisanlib/pid.py src/hardware/pid.py
# → pid.py에서 QSemaphore → threading.Lock으로 수정

cp lib/artisanlib/artisanlib/modbusport.py src/hardware/modbusport.py
# → QSemaphore → threading.Lock, QApplication.translate() 제거

cp lib/artisanlib/artisanlib/ble_port.py src/hardware/ble_port.py
# → QObject import 제거 + class ClientBLE(QObject): → class ClientBLE: 변경

cp lib/artisanlib/artisanlib/wsport.py src/hardware/wsport.py
cp lib/artisanlib/artisanlib/mqttport.py src/hardware/mqttport.py
# → QApplication.translate() 제거

# 3. 나머지 Qt 없는 파일은 원본을 직접 import
from artisanlib.async_comm import AsyncComm
from artisanlib.simulator import Simulator
from artisanlib.hottop import Hottop
from artisanlib.kaleido import KaleidoPort
# ...
```

### 8.5 최종: 당신의 프로젝트 구조

```
your-project/
├── src/
│   ├── hardware/                    # PyQt6 제거된 포크 파일들
│   │   ├── pid.py                   # QSemaphore → threading.Lock
│   │   ├── modbusport.py            # QSemaphore → threading.Lock
│   │   ├── ble_port.py              # QObject import 삭제 + ClientBLE(QObject) → ClientBLE
│   │   ├── wsport.py                # QApplication.translate() 제거
│   │   └── mqttport.py              # QApplication.translate() 제거
│   │
│   ├── vendor/artisanlib/           # Git submodule (원본)
│   │   ├── async_comm.py            # ✅ 그대로 사용
│   │   ├── simulator.py             # ✅ 그대로 사용
│   │   ├── hottop.py                # ✅ 그대로 사용
│   │   ├── kaleido.py               # ✅ 그대로 사용
│   │   ├── aillio_r1.py             # ✅ 그대로 사용
│   │   ├── santoker.py              # ✅ 그대로 사용
│   │   ├── pid.py                   # ❌ 사용 안 함 (포크 사용)
│   │   └── ...
│   │
│   ├── roaster_registry.py          # ROASTER_REGISTRY
│   ├── roaster_manager.py           # 로스터 관리자
│   └── main.py                      # 당신의 UI/UX
```

```python
# roaster_manager.py — 최종 통합 예
import asyncio
from typing import Protocol
from pymodbus.client import AsyncModbusTcpClient

# Qt 없는 원본 모듈 — 직접 import
from vendor.artisanlib.simulator import Simulator
from vendor.artisanlib.hottop import Hottop
from vendor.artisanlib.kaleido import KaleidoPort

# Qt 제거된 포크 모듈
from hardware.pid import PID

# 모든 드라이버의 공통 인터페이스
class RoasterDriver(Protocol):
    def getBTET(self) -> tuple[float, float]: ...

class RoasterManager:
    """로스터 종류와 무관하게 동일한 인터페이스 제공"""

    def __init__(self, config: dict):
        device_id = config['device_id']
        self.driver = self._create_driver(device_id, config)
        self.pid = self._create_pid(device_id, config)

    def _create_driver(self, device_id: int, config: dict) -> RoasterDriver:
        """device_id에 따라 적절한 드라이버 생성"""
        if device_id == 53:
            return Hottop(port=config['comport'])
        elif device_id == 138:
            return KaleidoPort(host=config['host'], port=config['port'])
        elif device_id == 29:
            return AsyncModbusTcpClient(config['host'])
        elif device_id == 0:
            return Simulator(mode='C', profile=config['profile'])
        # ... 필요한 만큼 추가

    def read_temperatures(self) -> tuple[float, float]:
        return self.driver.getBTET()
```

### 8.6 요약: PyQt6 제거 작업량

| 모듈            | 원본 라인 수 | 변경할 라인 수 | 변경 내용                                                                                      |
| --------------- | ------------ | -------------- | ---------------------------------------------------------------------------------------------- |
| `pid.py`        | 819          | **3줄**        | `QSemaphore` → `threading.Lock`                                                                |
| `modbusport.py` | 1116         | **4줄**        | `QSemaphore` → `Lock`, `translate()` 제거                                                      |
| `ble_port.py`   | 557          | **2줄**        | `from PyQt6.QtCore import QObject` 삭제 + `class ClientBLE(QObject):` → `class ClientBLE:` 변경 |
| `wsport.py`     | 407          | **2줄**        | `from PyQt6.QtWidgets import QApplication` 삭제                                                |
| `mqttport.py`   | 304          | **2줄**        | `from PyQt6.QtWidgets import QApplication` 삭제                                                |
| `s7port.py`     | ~200         | **4줄**        | `QSemaphore` → `Lock`, `translate()` 제거                                                      |
| `orbiter.py`    | ~700         | **~5줄**       | `QDateTime` → `datetime`, `translate()` 제거                                                   |
| **합계**        | **~4100줄**  | **~22줄**      | **0.5%만 수정**                                                                                |

> **결론:** artisanlib의 하드웨어 연동 코드 중 **단 ~22줄(0.5%)만 수정**하면 PyQt6 의존성을 완전히 제거할 수 있다. 나머지 99.5%는 그대로 import해서 사용 가능하다. 순수 드라이버 파일(hottop.py, kaleido.py, aillio_r1.py, santoker.py 등)은 **단 1줄도 수정할 필요가 없다.**

---

## 9. 요약

| 항목                  | 내용                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| **artisanlib의 가치** | 20년 검증된 하드웨어 연동 코드 — 재발명 불필요                                                          |
| **.aset 파일**        | INI 파일 자체는 불필요. 단, 담고 있는 **통신 방식·레지스터 맵·PID 게인** 정보는 `ROASTER_REGISTRY`에 포함 |
| **통신 설정**         | host/port/comport는 사용자 환경 의존 — 외부 프로젝트 UI에서 입력받을 것                                 |
| **PID 게인**          | 제조사 튜닝값은 가치 있음 — 지원할 로스터의 .aset만 선별 참고                                           |
| **최소 테스트 전략**  | 이미 검증된 계층은 테스트 제로, 신규 프로토콜 파싱만 단위 테스트                                        |
| **가장 쉬운 방법**    | MODBUS/WebSocket/MQTT — 설정만으로 연동, 테스트 불필요                                                  |
| **개발 가속화**       | Simulator로 하드웨어 없이 개발 → 1회 E2E 테스트로 연결 확인                                             |
| **PID 사용**          | Qt Mocking 패턴으로 독립 사용 가능, UAT 스위트 이미 존재                                                |
| **신규 드라이버**     | AsyncComm/ClientBLE 상속 → 프로토콜 파싱만 구현 → 단위 테스트                                          |

> **결론:** `artisanlib`은 하드웨어 연동의 **"검증된 레고 블록"** 이다. 외부 프로젝트는 이 블록을 조립만 하면 되며, 새로 작성하는 코드(프로토콜 파싱 등)에 대해서만 최소한의 단위 테스트를 추가하면 된다. `.aset` 파일의 **통신 방식·레지스터 맵·PID 게인 정보**는 `ROASTER_REGISTRY`에 포함하고, INI 파일 100개를 프로젝트에 가져올 필요는 없다.
