# Hardware Registry Redesign Plan

> **상태:** 구현 진행 중  
> **관련 파일:** `src-tauri/sidecar/roaster_registry.py`, `src-tauri/sidecar/main.py`  
> **선행 문서:** `hardware-integration-analysis.md`, `hardware-integration-artisanlib-final.md`

---

## 배경 및 결정 사항

### 지원 브랜드 (확정)

| 브랜드 | 프로토콜 | .aset 경로 |
|--------|---------|-----------|
| Giesen (Classic: W1A~W140A) | s7 | Giesen/W6A.aset 등 |
| Giesen (WxA/WxA+ Series) | s7 | Giesen/WxA.aset 등 |
| Probat G/UG | s7 또는 probat_ws | Probat/G_UG.aset, G_UG_WebSockets.aset |
| Kaleido | kaleido (WS) 또는 modbus | Kaleido/Network.aset, Serial.aset |
| Diedrich CR/DR | modbus | Diedrich/CR.aset |
| Easyster | modbus | Easyster/2Temp.aset |
| Proaster | modbus | Proaster/2Temp.aset |
| Trinitas T2/T7 | modbus | TRINITAS/T2.aset, T7.aset |
| Loring Smart Roast / Auto | modbus | Loring/Smart_Roast.aset, Smart_Roast_Auto.aset |
| Phidget 장착 로스터 | phidget | Phidget/*.aset |

### 제외 브랜드 (명시적 결정)
- **Hottop** — 제외
- **Aillio R1/R2** — 제외
- **Stronghold** — 파일 임포트 전용 (XLSX), 실시간 드라이버 없음

### 향후 확장 가능 프로토콜 (현재 미지원)
- `mqtt` — ROEST (100/200/P3000), device_id=201
- `opcua` — 일부 산업용 대형 로스터
- `usb_hid` — Aillio R1/R2 (제외됨, 나중에 재고 가능)
- `async_serial` — Hottop (제외됨)
- `ikawa`, `santoker`, `orbiter` 등 — 필요 시 추가

---

## 아키텍처 원칙

**새 로스터 추가 = 2개 파일만 수정:**
1. `roaster_registry.py` — 항목 추가
2. `main.py` — 새 프로토콜인 경우에만 Adapter 클래스 추가

프론트엔드는 `GET /roasters`로 registry를 fetch해서 동적으로 폼 렌더링.  
하드코딩 없음. 프론트엔드 코드 수정 불필요.

```
protocol string → _PROTOCOL_ADAPTER dict → Adapter class
"s7"            → S7Adapter
"kaleido"       → KaleidoAdapter
"probat_ws"     → ProbatWSAdapter
"modbus"        → ModbusAdapter
"phidget"       → PhidgetAdapter
"simulator"     → SimulatorAdapter
```

---

## Registry 구조 설계

```python
{
    "roaster_key": {
        "display_name": str,       # UI 표시 이름
        "brand": str,              # 브랜드명 (그룹핑용)
        "models": list[str],       # 이 항목이 커버하는 모델명
        "protocol": str,           # 어댑터 라우팅 키
        "default_params": dict,    # 프로토콜별 기본 연결 설정
        "capabilities": list[str], # ["heater", "fan", "drum"] — 제어 가능 채널
        # form_fields는 PROTOCOL_FORM_FIELDS에서 protocol 키로 자동 생성
    }
}
```

### PROTOCOL_FORM_FIELDS (프론트엔드 폼 자동 생성용)

```python
PROTOCOL_FORM_FIELDS = {
    "s7": [
        {"key": "host",  "label": "PLC IP Address", "type": "text",   "required": True},
        {"key": "port",  "label": "Port",            "type": "number", "required": False},
        {"key": "rack",  "label": "Rack",            "type": "number", "required": False},
        {"key": "slot",  "label": "Slot",            "type": "number", "required": False},
    ],
    "kaleido": [
        {"key": "mode",  "label": "Mode",            "type": "select", "options": ["TCP","Serial"], "required": True},
        {"key": "host",  "label": "IP Address",      "type": "text",   "required": False},
        {"key": "port",  "label": "Port",            "type": "number", "required": False},
        {"key": "comport","label":"Serial Port",     "type": "text",   "required": False},
    ],
    "probat_ws": [
        {"key": "host",  "label": "IP Address",      "type": "text",   "required": True},
        {"key": "port",  "label": "Port",            "type": "number", "required": False},
    ],
    "modbus": [
        {"key": "mode",    "label": "Connection",    "type": "select", "options": ["tcp","rtu"], "required": True},
        {"key": "host",    "label": "IP Address",    "type": "text",   "required": False},
        {"key": "port",    "label": "Port",          "type": "number", "required": False},
        {"key": "comport", "label": "Serial Port",   "type": "text",   "required": False},
        {"key": "baudrate","label": "Baud Rate",     "type": "number", "required": False},
    ],
    "phidget": [
        {"key": "device_type",   "label": "Phidget Model", "type": "select",
         "options": ["TMP1101","TMP1200","TMP1202","1048"], "required": True},
        {"key": "channel_bt",    "label": "BT Channel",    "type": "number", "required": True},
        {"key": "channel_et",    "label": "ET Channel",    "type": "number", "required": False},
        {"key": "serial_number", "label": "Serial No. (optional)", "type": "number", "required": False},
    ],
    "simulator": [],  # 설정 없음
}
```

---

## .aset 추출 데이터

### Giesen — S7

Giesen은 모든 모델이 S7. 두 가지 레지스터 레이아웃으로 분류됨.

#### Classic Series (W1A, W1E, W6A, W6E, W15A, W15E, W30A, W30A_PRO, W45A, W60A, W140A)

```
host: 172.30.30.x  (모델/사이트마다 다름, 사용자가 입력)
port: 102
rack: 0 / slot: 0

채널 레지스터:
  BT:     db=3, offset=116(or 118 for W1/Sample), area=6, type=1(INT)
  ET:     db=3, offset=112(or 114 for W1/Sample), area=6, type=1(INT)
  heater: db=2, offset=18, area=6, type=0
  fan:    db=2, offset=10, area=6, type=0
  drum:   db=2, offset=14, area=6, type=0
  AT:     db=2, offset=54, area=6, type=0
```

W6A_PRO는 db_nr=1006 (다른 PLC 세대, 별도 항목 처리).

#### WxA / WxA+ Series (WxA, WxA+, WxA_IR, WxA+_IR 등)

```
host: 192.168.2.180  (사용자가 입력)
port: 102
rack: 0 / slot: 0

WxA 채널:
  BT: db=2, offset=38, area=6, type=0(REAL)
  ET: db=2, offset=36, area=6, type=0(REAL)

WxA+ 채널:
  BT: db=4, offset=10, area=6, type=1(INT)
  ET: db=4, offset=6,  area=6, type=1(INT)
```

### Probat — S7 + WebSocket

#### G_UG (S7)
```
host: 10.32.176.124  (사용자가 입력)
port: 102 / rack: 0 / slot: 0

채널:
  BT: db=100, offset=4,  area=6, type=1(INT)
  ET: db=100, offset=8,  area=6, type=1(INT)
  heater(burner): db=100, offset=0, area=6, type=1
  exhaust_fan:    db=100, offset=22, area=6, type=0
```

#### G_UG_WebSockets (WebSocket)
```
host: 127.0.0.1  (사용자가 입력)
port: 80

channel_nodes:
  BT: "beanTemp"
  ET: "ambientTemp"
  heater: "burner"
  fan: "exhaustFan"
  drum: "drum"
  at: "intakeAirTemp"
```

### Kaleido — WebSocket / MODBUS

#### Network (WebSocket)
```
device_id: 138
host: 127.0.0.1 / port: 80
path: "ws"
```

#### Serial (MODBUS RTU)
```
device_id: 138
comport: COM4
baudrate: 57600
```

artisanlib의 `kaleido.py` 드라이버가 두 모드 모두 지원. `KaleidoPort.start(mode="TCP"|"Serial")`.

### MODBUS 브랜드들

| 브랜드 | TCP port | RTU baudrate | 비고 |
|--------|----------|-------------|------|
| Diedrich CR/DR | 8010 | 115200 | host=125.135.119.211 (예시) |
| Easyster | 502 | 9600 | |
| Proaster | 502 | 9600 | |
| Trinitas T2/T7 | 502 | 38400 | |

모두 device_id=29 (MODBUS). MODBUS 레지스터 주소는 브랜드별로 다르며  
artisanlib `modbusport.py`가 처리.

---

## 사이드카 엔드포인트 (추가 필요)

```
GET  /roasters        → ROASTER_REGISTRY + PROTOCOL_FORM_FIELDS 반환
POST /connect         → {roaster: "giesen_classic", host: "172.30.30.50", ...}
GET  /status          → 현재 연결 상태
GET  /temperatures    → {bt, et, ror, heater, fan, timestamp}
POST /control         → {heater?, fan?, drum?}
POST /disconnect
```

---

## 구현 순서

### Phase 1 — 현재 작업 (사이드카 재설계)
- [x] 아키텍처 결정 및 문서화
- [ ] `roaster_registry.py` 재설계 (protocol 기반, 브랜드 전체 포함)
- [ ] `main.py` 정리 (HottopAdapter, AillioR1Adapter 제거, S7/MODBUS/ProbatWS 어댑터 추가)
- [ ] `GET /roasters` 엔드포인트 추가
- [ ] `artisanlib/comm.py`, `ports.py`, `devices.py` 제거 (Qt 지뢰)

### Phase 2 — 프론트엔드 연동
- [ ] `src/shared/types/machine.ts` — Machine 타입 정의
- [ ] `src/shared/data/useMachines.ts` — persistent 머신 목록
- [ ] `src/shared/lib/sidecar.ts` — HTTP 클라이언트
- [ ] `AddMachineModal` 재설계 — `/roasters` fetch → 동적 폼
- [ ] `Machines.tsx` — 실제 연결 상태, Connect/Disconnect, 온도 폴링

### Phase 3 — 어댑터 구현
- [ ] `S7Adapter` — `artisanlib/s7port.py` (Qt 제거 필요: QSemaphore → Lock)
- [ ] `ModbusAdapter` — `artisanlib/modbusport.py` (Qt 제거)
- [ ] `ProbatWSAdapter` — WebSocket + channel_nodes 매핑
- [ ] `PhidgetAdapter` — `artisanlib/phidgets.py` + Phidget22 SDK

### Phase 4 — 파일 임포트 (별도 경로)
- [ ] Stronghold XLSX 임포트

### Loring BCD 디코딩 (ModbusAdapter 확장)
- [ ] `modbus_registers`의 `bcd: true` 플래그 처리 — BCD 디코딩 후 div 적용
- [ ] `bcd_as_int: true` 플래그 처리 — drum 속도 (정수 그대로 읽기)
- [ ] 온도 `mode: "F"` → °C 변환 (Diedrich CR/DR과 동일한 경로 공유 가능)
- [ ] `auto_status` 채널 — func=2 (Discrete Input) 읽기

---

## Qt 제거 작업 요약 (Phase 3 전제)

artisanlib 파일 중 사이드카에서 사용할 파일들의 Qt 의존성:

| 파일 | 변경 | 변경량 |
|------|------|--------|
| `s7port.py` | QSemaphore → threading.Lock, translate() 제거 | ~4줄 |
| `modbusport.py` | QSemaphore → threading.Lock, translate() 제거 | ~4줄 |
| `ble_port.py` | (현재 미사용, 제외) | — |
| `wsport.py` | translate() 제거 | ~2줄 |

`kaleido.py`, `simulator.py`, `async_comm.py` 등 주요 드라이버는 Qt 의존성 없음.
