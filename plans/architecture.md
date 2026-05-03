# First Crack Desktop — 전체 아키텍처

> 작성일: 2026-05-01  
> 기준 파일: `src-tauri/sidecar/main.py`, `roaster_registry.py`, `src/shared/lib/sidecar.ts`

---

## 1. 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                   Tauri Desktop App                     │
│                                                         │
│  ┌─────────────────────────┐   ┌─────────────────────┐ │
│  │   React Frontend        │   │  Python Sidecar     │ │
│  │   (Vite + Tailwind)     │◄──►  (aiohttp, :9999)  │ │
│  │                         │   │                     │ │
│  │  sidecar.ts             │   │  main.py            │ │
│  │  HTTP → 127.0.0.1:9999  │   │  RoasterManager     │ │
│  └─────────────────────────┘   └──────────┬──────────┘ │
│                                            │            │
└────────────────────────────────────────────┼────────────┘
                                             │
                              ┌──────────────▼──────────────┐
                              │        실제 로스터기          │
                              │  Modbus / S7 / WebSocket /  │
                              │  Kaleido / Phidget          │
                              └─────────────────────────────┘
```

---

## 2. Sidecar HTTP API

프론트엔드와 사이드카는 **REST over HTTP (localhost:9999)** 로 통신.  
Tauri IPC를 사용하지 않고 HTTP를 선택한 이유: 프론트엔드 개발 시 Tauri 없이 브라우저만으로 테스트 가능.

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/roasters` | 지원 로스터 전체 목록 + 프로토콜별 폼 필드 |
| `GET` | `/status` | 현재 연결 상태 (connected, roaster, uptime, error) |
| `POST` | `/connect` | `{"roaster": "easyster", "host": "...", ...}` |
| `POST` | `/disconnect` | 연결 해제 |
| `GET` | `/temperatures` | `{"bt", "et", "ror", "heater", "fan", "timestamp"}` |
| `POST` | `/control` | `{"heater"?: 0-100, "fan"?: 0-100, "drum"?: 0-100}` |

### RoR (Rate of Rise) 계산
사이드카가 직접 계산. BT의 최근 30초 데이터를 선형 최소제곱법으로 기울기(°C/min) 산출.  
→ 프론트엔드는 계산 없이 값만 받아서 표시.

---

## 3. 사이드카 내부 구조

```
main.py
│
├── RoasterManager          # 단일 연결 상태 관리자 (asyncio.Lock 보호)
│   ├── connect(roaster_key, params)
│   │    └── _make_adapter(protocol, merged_params) → Adapter
│   ├── read_temperatures() → BT/ET/RoR dict
│   ├── send_control(heater, fan, drum)
│   └── status() → dict
│
├── _make_adapter(protocol) → 해당 Adapter 인스턴스
│   ├── "simulator"  → SimulatorAdapter
│   ├── "kaleido"    → KaleidoAdapter
│   ├── "s7"         → S7Adapter
│   ├── "modbus"     → ModbusAdapter
│   ├── "probat_ws"  → ProbatWSAdapter
│   └── "phidget"    → PhidgetAdapter
│
└── HTTP handlers (aiohttp)
    └── 각 엔드포인트 → RoasterManager 메서드 호출
```

### 공통 Adapter 인터페이스

모든 어댑터는 아래 4개 메서드를 구현:

```python
async def connect() -> None
async def disconnect() -> None
async def read() -> Reading          # Reading(bt, et, heater, fan, timestamp)
async def control(heater, fan, drum) -> None
```

---

## 4. 어댑터별 구현 방식

| 어댑터 | 프로토콜 | 구현 방식 | 지원 브랜드 |
|--------|---------|---------|-----------|
| `SimulatorAdapter` | — | `artisanlib/simulator.py` 직접 사용 | 개발/테스트용 |
| `KaleidoAdapter` | WebSocket / MODBUS RTU | `artisanlib/kaleido.py` 직접 사용 (Qt 없음) | Kaleido |
| `S7Adapter` | Siemens S7 (TCP:102) | `python-snap7` 직접 구현 (artisanlib/s7port.py 참고용) | Giesen, Probat G/UG S7 |
| `ModbusAdapter` | MODBUS TCP / RTU | `pymodbus 3.x AsyncClient` 직접 구현 (artisanlib/modbusport.py 참고용) | Diedrich, Easyster, Proaster, Trinitas, Probat Probatone, **Loring** |
| `ProbatWSAdapter` | WebSocket | `websockets` 직접 구현 (artisanlib/wsport.py 참고용) | Probat WS 계열 |
| `PhidgetAdapter` | USB (Phidget22 SDK) | `Phidget22` 직접 구현 | Phidget TMP1101/1200/1048 |

### artisanlib 파일 사용 현황

| 파일 | 상태 | 이유 |
|------|------|------|
| `artisanlib/simulator.py` | ✅ 직접 import | Qt 의존성 없음 |
| `artisanlib/kaleido.py` | ✅ 직접 import | Qt 의존성 없음, websockets만 사용 |
| `artisanlib/modbusport.py` | 📄 참고용 (미사용) | `PyQt6.QSemaphore`, `self.aw.qmc` 등 Qt 깊이 결합 |
| `artisanlib/s7port.py` | 📄 참고용 (미사용) | 동일 |
| `artisanlib/wsport.py` | 📄 참고용 (미사용) | 동일 |
| `artisanlib/phidgets.py` | 📄 참고용 (미사용) | 동일 |

---

## 5. 로스터 레지스트리 (roaster_registry.py)

새 로스터 추가 시 수정하는 파일이 **이것 하나**.  
프론트엔드 코드 수정 불필요 — `GET /roasters`로 자동 반영.

```python
ROASTER_REGISTRY = {
    "easyster": {
        "display_name": "Easyster (Standard)",
        "brand": "Easyster",
        "models": ["2Temp", "3Temp", "AirPressure"],
        "protocol": "modbus",               # → ModbusAdapter 라우팅
        "capabilities": ["bt", "et"],
        "default_params": {
            "mode": "tcp",
            "host": "127.0.0.1",
            "port": 502,
            "modbus_registers": {           # 실제 레지스터 주소 (artisan .aset 기반)
                "BT": {"register": ..., "func": 4, "unit_id": 1, "div": 1},
                "ET": {"register": ..., "func": 4, "unit_id": 2, "div": 1},
            },
        },
        "pid": None,
    },
    ...
}
```

`PROTOCOL_FORM_FIELDS`로 프론트엔드 폼 필드 자동 생성:
- `s7` → IP, Port, Rack, Slot
- `modbus` → Connection(TCP/RTU), IP/Port 또는 SerialPort/Baudrate
- `kaleido` → Mode(TCP/Serial), IP 또는 SerialPort
- `phidget` → Model, BT Channel, ET Channel, Serial No.
- `probat_ws` → IP, Port
- `simulator` → 없음 (설정 불필요)

---

## 6. 프론트엔드 → 사이드카 연결 (sidecar.ts)

```typescript
// src/shared/lib/sidecar.ts
const BASE = 'http://127.0.0.1:9999';

export const sidecar = {
  getRoasters: () => request<RoastersResponse>('/roasters'),
  getStatus:   () => request<SidecarStatus>('/status'),
  connect:     (roasterKey, params) => request<SidecarStatus>('/connect', { method: 'POST', ... }),
  disconnect:  () => request<SidecarStatus>('/disconnect', { method: 'POST' }),
  getTemperatures: () => request<TemperatureReading>('/temperatures'),
  control:     (params) => request<{ ok: boolean }>('/control', { method: 'POST', ... }),
};
```

---

## 7. 지원 브랜드 목록

| 브랜드 | 프로토콜 | 어댑터 | 상태 |
|--------|---------|--------|------|
| Giesen W1A~W140A (Classic) | S7 TCP:102 | S7Adapter | ✅ 구현 완료 (snap7 미설치) |
| Giesen WxA / WxA+ | S7 TCP:102 | S7Adapter | ✅ 구현 완료 (snap7 미설치) |
| Probat G/UG (S7) | S7 TCP:102 | S7Adapter | ✅ 구현 완료 (snap7 미설치) |
| Probat G/UG / P-Series (WebSocket) | WebSocket | ProbatWSAdapter | ✅ 구현 완료 |
| Probat Probatone / 7" | MODBUS | ModbusAdapter | ✅ 구현 완료 |
| Kaleido | WebSocket / MODBUS RTU | KaleidoAdapter | ✅ 구현 완료 |
| Diedrich CR / DR | MODBUS | ModbusAdapter | ✅ 구현 완료 |
| Diedrich Data Logging | Phidget | PhidgetAdapter | ✅ 구현 완료 (Phidget22 미설치) |
| Easyster (Standard / Smart) | MODBUS | ModbusAdapter | ✅ 구현 완료 |
| Proaster (Standard / THCR-01A) | MODBUS | ModbusAdapter | ✅ 구현 완료 |
| Trinitas T2 / T7 | MODBUS | ModbusAdapter | ✅ 구현 완료 |
| Loring Smart Roast / Auto (S7~S135) | MODBUS TCP:502 | ModbusAdapter | ⚠️ 레지스트리 등록 완료, BCD 디코딩 구현 필요 |
| Phidget TMP1101 / TMP1200 / 1048 | Phidget USB | PhidgetAdapter | ✅ 구현 완료 (Phidget22 미설치) |
| Simulator | — | SimulatorAdapter | ✅ 동작 확인 (기본 자동 연결) |

### 명시적 제외
- **Hottop** — 제외
- **Aillio R1/R2** — 제외
- **Stronghold** — 파일 임포트 전용 (XLSX), 실시간 드라이버 없음

---

## 8. 미완료 / 알려진 이슈

| 항목 | 내용 |
|------|------|
| `python-snap7` 미설치 | S7Adapter 동작 불가. `brew install snap7 && pip install python-snap7` 필요 |
| `Phidget22` 미설치 | PhidgetAdapter 동작 불가. 시스템 드라이버 + pip install 필요 |
| KaleidoAdapter `sleep(1.0)` | connect() 에서 1초 고정 대기. KaleidoPort on_connect 콜백 노출되면 교체 필요 |
| MODBUS 브랜드 제어 미구현 | `control()` 현재 no-op. 히터/팬 write_register 확장 필요 시 ModbusAdapter에 추가 |
| Loring BCD 디코딩 미구현 | ModbusAdapter가 `bcd: true` 플래그를 아직 처리 안 함. BCD 디코딩(÷10) + °F→°C 변환 + `bcd_as_int` drum 읽기 추가 필요 |
| Probat WS 제어 미구현 | 동일. Probat WS push message 포맷 확인 후 추가 |
| sidecar 시작 방식 | 현재 수동 실행. Tauri sidecar 프로세스로 자동 기동 연결 필요 |
| Simulator 자동 연결 | 개발용. 배포 시 on_startup에서 자동 연결 제거 필요 |
