"""
roaster_registry.py
===================
지원 로스터 브랜드/모델 레지스트리.

새 로스터 추가 방법:
  1. 아래 ROASTER_REGISTRY에 항목 추가
  2. 새 프로토콜인 경우에만 main.py에 Adapter 클래스 추가
  → 프론트엔드 코드 수정 불필요 (GET /roasters로 자동 반영)

프로토콜별 사용 브랜드 레퍼런스 (확장 시 참고)
  s7          → Giesen (W1A~W140A, WxA/WxA+), Probat G/UG (S7 모델)
  kaleido     → Kaleido Network/Serial (kaleido.py 전용 드라이버)
  probat_ws   → Probat WebSocket 모델 (G_UG_WS, P_Series_III, Sample_Roaster)
  modbus      → Probat Probatone, Diedrich CR/DR, Easyster, Proaster, Trinitas
  phidget     → Diedrich Data Logging (id=34), Phidget 장착 범용 로스터
  virtual     → 개발/테스트용 가상 머신
  mqtt        → ROEST (100/200/P3000). 미지원, 추후 MqttAdapter 추가 시 여기에 항목 추가.
  opcua       → 산업용 대형 로스터 일부. 미지원.
  usb_hid     → Aillio R1/R2. 제외 결정.
  async_serial → Hottop. 제외 결정.
  modbus      → Loring Smart Roast (S7/S15/S35/S70/S135). BCD 인코딩, °F 읽기 후 변환 필요.

출처: artisan/src/includes/Machines/ 각 브랜드별 .aset 파일

S7 type 필드: 0=INT(16-bit signed), 1=REAL(32-bit float)
S7 area 필드: 6=DB(Data Block)
S7 div  필드: 0=스케일링 없음
"""

import platform
from typing import Any

# OS별 시리얼 포트 placeholder
_comport_placeholder = {"Darwin": "/dev/cu.usbserial-XXXX", "Windows": "COM3"}.get(
    platform.system(), "/dev/ttyUSB0"
)


# ---------------------------------------------------------------------------
# 프로토콜별 프론트엔드 폼 필드 정의
# GET /roasters 응답에 포함 → AddMachineModal 동적 렌더링
# ---------------------------------------------------------------------------

PROTOCOL_FORM_FIELDS: dict[str, list[dict[str, Any]]] = {
    "s7": [
        {
            "key": "host",
            "label": "PLC IP Address",
            "type": "text",
            "required": True,
            "placeholder": "192.168.1.100",
        },
        {
            "key": "port",
            "label": "Port",
            "type": "number",
            "required": False,
            "placeholder": "102",
        },
        {
            "key": "rack",
            "label": "Rack",
            "type": "number",
            "required": False,
            "placeholder": "0",
        },
        {
            "key": "slot",
            "label": "Slot",
            "type": "number",
            "required": False,
            "placeholder": "0",
        },
    ],
    "kaleido": [
        {
            "key": "mode",
            "label": "Connection Mode",
            "type": "select",
            "required": True,
            "options": [
                {"value": "TCP", "label": "Network (WebSocket)"},
                {"value": "Serial", "label": "Serial (MODBUS)"},
            ],
        },
        {
            "key": "host",
            "label": "IP Address",
            "type": "text",
            "required": False,
            "placeholder": "127.0.0.1",
        },
        {
            "key": "port",
            "label": "Port",
            "type": "number",
            "required": False,
            "placeholder": "80",
        },
        {
            "key": "comport",
            "label": "Serial Port",
            "type": "text",
            "required": False,
            "placeholder": _comport_placeholder,
        },
        {
            "key": "baudrate",
            "label": "Baud Rate",
            "type": "number",
            "required": False,
            "placeholder": "57600",
        },
    ],
    "probat_ws": [
        {
            "key": "host",
            "label": "IP Address",
            "type": "text",
            "required": True,
            "placeholder": "127.0.0.1",
        },
        {
            "key": "port",
            "label": "Port",
            "type": "number",
            "required": False,
            "placeholder": "80",
        },
    ],
    "modbus": [
        {
            "key": "mode",
            "label": "Connection",
            "type": "select",
            "required": True,
            "options": [
                {"value": "tcp", "label": "TCP/IP"},
                {"value": "rtu", "label": "Serial RTU"},
            ],
        },
        {
            "key": "host",
            "label": "IP Address",
            "type": "text",
            "required": False,
            "placeholder": "127.0.0.1",
        },
        {"key": "port", "label": "Port", "type": "number", "required": False},
        {
            "key": "comport",
            "label": "Serial Port",
            "type": "text",
            "required": False,
            "placeholder": _comport_placeholder,
        },
        {"key": "baudrate", "label": "Baud Rate", "type": "number", "required": False},
    ],
    "phidget": [
        {
            "key": "device_type",
            "label": "Phidget Model",
            "type": "select",
            "required": True,
            "options": [
                {"value": "TMP1101", "label": "TMP1101 (4x TC)"},
                {"value": "TMP1200", "label": "TMP1200 (1x RTD)"},
                {"value": "TMP1202", "label": "TMP1202 (2x RTD)"},
                {"value": "1048", "label": "1048 (4x TC, USB)"},
            ],
        },
        {
            "key": "channel_bt",
            "label": "BT Channel (0-3)",
            "type": "number",
            "required": True,
            "placeholder": "0",
        },
        {
            "key": "channel_et",
            "label": "ET Channel (0-3)",
            "type": "number",
            "required": False,
            "placeholder": "1",
        },
        {
            "key": "serial_number",
            "label": "Serial Number (optional)",
            "type": "number",
            "required": False,
        },
    ],
    "virtual": [],
}


# ---------------------------------------------------------------------------
# 로스터 레지스트리
# ---------------------------------------------------------------------------

ROASTER_REGISTRY: dict[str, dict[str, Any]] = {
    # -----------------------------------------------------------------------
    # Virtual Machine (가상 머신)
    # -----------------------------------------------------------------------
    "virtual": {
        "display_name": "가상 머신",
        "brand": "Internal",
        "models": ["가상 머신"],
        "protocol": "virtual",
        "default_params": {"mode": "C"},
        "pid": None,
        "capabilities": ["heater", "fan", "drum"],
    },
    # -----------------------------------------------------------------------
    # Custom — address maps (modbus_registers / channels) from client params
    # -----------------------------------------------------------------------
    "custom_modbus": {
        "display_name": "Custom Modbus",
        "brand": "Internal",
        "models": ["Custom"],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 9600,
            "bytesize": 8,
            "parity": "N",
            "stopbits": 1,
            "interval": 1,
            # Client must supply modbus_registers on connect
            "modbus_registers": {},
        },
        "pid": None,
        "capabilities": [],
    },
    "custom_s7": {
        "display_name": "Custom S7",
        "brand": "Internal",
        "models": ["Custom"],
        "protocol": "s7",
        "default_params": {
            "host": "192.168.1.100",
            "port": 102,
            "rack": 0,
            "slot": 0,
            # Client must supply channels on connect
            "channels": [],
        },
        "pid": None,
        "capabilities": [],
    },
    "custom_phidget": {
        "display_name": "Custom Phidget",
        "brand": "Internal",
        "models": ["Custom"],
        "protocol": "phidget",
        "default_params": {
            "device_type": "TMP1101",
            "channel_bt": 0,
            "channel_et": 1,
        },
        "pid": None,
        "capabilities": [],
    },
    "custom_kaleido": {
        "display_name": "Custom Kaleido",
        "brand": "Internal",
        "models": ["Custom"],
        "protocol": "kaleido",
        "default_params": {
            "mode": "TCP",
            "host": "127.0.0.1",
            "port": 80,
            "path": "ws",
            "comport": "",
            "baudrate": 57600,
            "bytesize": 8,
            "parity": "N",
            "stopbits": 1,
            "interval": 1,
        },
        "pid": {"Kp": 15, "Ki": 0.07, "Kd": 0.06},
        "capabilities": ["heater", "fan", "drum"],
    },
    "custom_probat_ws": {
        "display_name": "Custom Probat WS",
        "brand": "Internal",
        "models": ["Custom"],
        "protocol": "probat_ws",
        "default_params": {
            "host": "127.0.0.1",
            "port": 80,
            # Standard Probat WS node names (override via connect params if needed)
            "channel_nodes": {
                "BT": "beanTemp",
                "ET": "exhaustAirTemp",
                "heater": "burner",
            },
        },
        "pid": None,
        "capabilities": ["heater", "fan", "drum"],
    },
    # -----------------------------------------------------------------------
    # Giesen — S7 (8개 항목)
    # 출처: Giesen/*.aset
    # 공통: port=102, rack=0, slot=0, div=0, PID Kp=20/Ki=0.01/Kd=3
    # -----------------------------------------------------------------------
    # W1A, W1E, Sample_WPE, Sample_WPG
    # BT=db3/118/INT, ET=db3/114/INT
    "giesen_w1": {
        "display_name": "Giesen W1A / W1E / Sample",
        "brand": "Giesen",
        "models": ["W1A", "W1E", "Sample WPE", "Sample WPG"],
        "protocol": "s7",
        "default_params": {
            "host": "172.30.30.30",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 3, "offset": 118, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 3, "offset": 114, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 2,
                    "offset": 48,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
                {"role": "drum", "db": 2, "offset": 14, "area": 6, "type": 0, "div": 0},
                {"role": "AT", "db": 2, "offset": 54, "area": 6, "type": 0, "div": 0},
            ],
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # W6A, W6E, W15A, W30A, W45A, W60A
    # BT=db3/116/INT, ET=db3/112/INT
    "giesen_standard": {
        "display_name": "Giesen W6A / W15A / W30A / W45A / W60A",
        "brand": "Giesen",
        "models": ["W6A", "W6E", "W15A", "W30A", "W45A", "W60A"],
        "protocol": "s7",
        "default_params": {
            "host": "172.30.30.50",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 3, "offset": 116, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 3, "offset": 112, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 2,
                    "offset": 48,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
                {"role": "drum", "db": 2, "offset": 14, "area": 6, "type": 0, "div": 0},
                {"role": "AT", "db": 2, "offset": 54, "area": 6, "type": 0, "div": 0},
            ],
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # W15E, W140A v1 — BT/ET=standard와 동일, 추가 채널 db3/184
    "giesen_w15e": {
        "display_name": "Giesen W15E / W140A (v1)",
        "brand": "Giesen",
        "models": ["W15E", "W140A v1"],
        "protocol": "s7",
        "default_params": {
            "host": "172.30.30.50",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 3, "offset": 116, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 3, "offset": 112, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 2,
                    "offset": 48,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
                {"role": "drum", "db": 2, "offset": 14, "area": 6, "type": 0, "div": 0},
                {"role": "AT", "db": 2, "offset": 54, "area": 6, "type": 0, "div": 0},
                {
                    "role": "extra",
                    "db": 3,
                    "offset": 184,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
            ],
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # W30A PRO — BT/ET=standard와 동일, 추가 채널 db2/54
    "giesen_w30a_pro": {
        "display_name": "Giesen W30A PRO",
        "brand": "Giesen",
        "models": ["W30A PRO"],
        "protocol": "s7",
        "default_params": {
            "host": "172.30.30.70",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 3, "offset": 116, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 3, "offset": 112, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 2,
                    "offset": 48,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
                {"role": "drum", "db": 2, "offset": 14, "area": 6, "type": 0, "div": 0},
                {"role": "AT", "db": 2, "offset": 54, "area": 6, "type": 0, "div": 0},
                {
                    "role": "extra",
                    "db": 2,
                    "offset": 54,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
            ],
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # W140A v2 — BT=db3/196/INT, ET=db3/192/INT (v1과 오프셋 완전히 다름)
    "giesen_w140a_v2": {
        "display_name": "Giesen W140A (v2)",
        "brand": "Giesen",
        "models": ["W140A v2"],
        "protocol": "s7",
        "default_params": {
            "host": "172.30.30.110",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 3, "offset": 196, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 3, "offset": 192, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 2,
                    "offset": 48,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
                {"role": "drum", "db": 2, "offset": 14, "area": 6, "type": 0, "div": 0},
                {"role": "AT", "db": 2, "offset": 54, "area": 6, "type": 0, "div": 0},
            ],
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # W6A PRO — 신형 PLC (DB 1006/1001), 기존 구조와 완전히 다름
    "giesen_w6a_pro": {
        "display_name": "Giesen W6A PRO",
        "brand": "Giesen",
        "models": ["W6A PRO"],
        "protocol": "s7",
        "default_params": {
            "host": "172.30.30.50",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {
                    "role": "BT",
                    "db": 1006,
                    "offset": 30,
                    "area": 6,
                    "type": 1,
                    "div": 0,
                },
                {
                    "role": "ET",
                    "db": 1006,
                    "offset": 16,
                    "area": 6,
                    "type": 1,
                    "div": 0,
                },
                {
                    "role": "heater",
                    "db": 1006,
                    "offset": 98,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {
                    "role": "fan",
                    "db": 1006,
                    "offset": 20,
                    "area": 6,
                    "type": 1,
                    "div": 0,
                },
                {
                    "role": "drum",
                    "db": 1006,
                    "offset": 106,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {
                    "role": "AT",
                    "db": 1006,
                    "offset": 96,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
            ],
            "pid_db": 1001,
            "pid_sv_register": 24,
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # WxA, WxA_coarse, WxA_IR, WxA_IR_Env — db2, REAL(type=0)
    # BT=db2/38/REAL, ET=db2/36/REAL
    "giesen_wxa": {
        "display_name": "Giesen WxA / WxA IR",
        "brand": "Giesen",
        "models": ["WxA", "WxA coarse", "WxA IR", "WxA IR Env"],
        "protocol": "s7",
        "default_params": {
            "host": "192.168.2.180",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 2, "offset": 38, "area": 6, "type": 0, "div": 0},
                {"role": "ET", "db": 2, "offset": 36, "area": 6, "type": 0, "div": 0},
                {
                    "role": "heater",
                    "db": 2,
                    "offset": 48,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
                {"role": "drum", "db": 2, "offset": 14, "area": 6, "type": 0, "div": 0},
            ],
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # WxA+, WxA+ IR, WxA+ IR Env — db4, INT(type=1)
    # BT=db4/10/INT, ET=db4/6/INT (WxA와 DB 번호, 오프셋, 타입 모두 다름)
    "giesen_wxa_plus": {
        "display_name": "Giesen WxA+ / WxA+ IR",
        "brand": "Giesen",
        "models": ["WxA+", "WxA+ IR", "WxA+ IR Env"],
        "protocol": "s7",
        "default_params": {
            "host": "192.168.2.180",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 4, "offset": 10, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 4, "offset": 6, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 2,
                    "offset": 18,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
                {"role": "drum", "db": 2, "offset": 14, "area": 6, "type": 0, "div": 0},
            ],
        },
        "pid": {"Kp": 20, "Ki": 0.01, "Kd": 3},
        "capabilities": ["heater", "fan", "drum"],
    },
    # -----------------------------------------------------------------------
    # Probat — S7 (2개), WebSocket (2개), MODBUS (2개)
    # 출처: Probat/*.aset
    # PID: 없음 (Probat 자체 PID 사용)
    # -----------------------------------------------------------------------
    # G_UG (S7) — db100
    # BT=db100/4/INT, ET=db100/8/INT
    "probat_gug_s7": {
        "display_name": "Probat G / UG (S7)",
        "brand": "Probat",
        "models": ["G Series", "UG Series"],
        "protocol": "s7",
        "default_params": {
            "host": "10.32.176.124",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 100, "offset": 4, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 100, "offset": 8, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 100,
                    "offset": 0,
                    "area": 6,
                    "type": 1,
                    "div": 0,
                },
                {
                    "role": "fan",
                    "db": 100,
                    "offset": 22,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {
                    "role": "drum",
                    "db": 100,
                    "offset": 28,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
            ],
        },
        "pid": None,
        "capabilities": ["heater", "fan", "drum"],
    },
    # G_UG_control (S7) — db200 (G_UG와 DB 번호, 오프셋 완전히 다름)
    # BT=db200/18/INT, ET=db200/22/INT
    # div[6]=2 (채널 6번 스케일링 있음)
    "probat_gug_control_s7": {
        "display_name": "Probat G / UG Control (S7)",
        "brand": "Probat",
        "models": ["G_UG_control"],
        "protocol": "s7",
        "default_params": {
            "host": "10.32.176.124",
            "port": 102,
            "rack": 0,
            "slot": 0,
            "channels": [
                {"role": "BT", "db": 200, "offset": 18, "area": 6, "type": 1, "div": 0},
                {"role": "ET", "db": 200, "offset": 22, "area": 6, "type": 1, "div": 0},
                {
                    "role": "heater",
                    "db": 200,
                    "offset": 14,
                    "area": 6,
                    "type": 1,
                    "div": 0,
                },
                {
                    "role": "fan",
                    "db": 200,
                    "offset": 30,
                    "area": 6,
                    "type": 1,
                    "div": 0,
                },
                {
                    "role": "drum",
                    "db": 200,
                    "offset": 80,
                    "area": 6,
                    "type": 0,
                    "div": 0,
                },
                {"role": "AT", "db": 200, "offset": 64, "area": 6, "type": 0, "div": 0},
                {
                    "role": "extra",
                    "db": 200,
                    "offset": 44,
                    "area": 6,
                    "type": 0,
                    "div": 2,
                },
            ],
        },
        "pid": None,
        "capabilities": ["heater", "fan", "drum"],
    },
    # G_UG_WebSockets + P_Series_III — WebSocket, 동일한 channel_nodes
    "probat_ws": {
        "display_name": "Probat G / UG / P-Series (WebSocket)",
        "brand": "Probat",
        "models": ["G_UG WebSockets", "P Series III"],
        "protocol": "probat_ws",
        "default_params": {
            "host": "127.0.0.1",
            "port": 80,
            "channel_nodes": {
                "BT": "beanTemp",
                "ET": "ambientTemp",
                "heater": "burner",
                "fan": "exhaustFan",
                "drum": "drum",
                "AT": "intakeAirTemp",
                "exhaust_AT": "exhaustAirTemp",
                "cooling_AT": "coolingAirTemp",
            },
        },
        "pid": None,
        "capabilities": ["heater", "fan", "drum"],
    },
    # Sample_Roaster — WebSocket, channel_nodes 일부 비어있음
    "probat_sample_ws": {
        "display_name": "Probat Sample Roaster (WebSocket)",
        "brand": "Probat",
        "models": ["Sample Roaster"],
        "protocol": "probat_ws",
        "default_params": {
            "host": "127.0.0.1",
            "port": 80,
            "channel_nodes": {
                "BT": "beanTemp",
                "ET": "exhaustAirTemp",
                "heater": "burner",
            },
        },
        "pid": None,
        "capabilities": ["heater"],
    },
    # Probatone — MODBUS RTU, BT만 읽힘 (ET deviceId=0 → 비활성)
    # BT: register=12392, func=3, float=false, div=2(÷100), unit_id=1
    "probat_probatone": {
        "display_name": "Probat Probatone",
        "brand": "Probat",
        "models": ["Probatone"],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 115200,
            "modbus_registers": {
                "BT": {
                    "register": 12392,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 2,
                    "mode": "C",
                },
                "ET": None,  # 비활성
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # Probatone 7'' — ET register가 Probatone과 다름 (12393, div=2)
    # BT: register=12392, ET: register=12393, func=3, div=2(÷100), unit_id=1
    "probat_probatone_7": {
        "display_name": 'Probat Probatone 7"',
        "brand": "Probat",
        "models": ['Probatone 7"'],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 115200,
            "modbus_registers": {
                "BT": {
                    "register": 12392,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 2,
                    "mode": "C",
                },
                "ET": {
                    "register": 12393,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 2,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # -----------------------------------------------------------------------
    # Kaleido — kaleido.py 전용 드라이버 (id=138)
    # 출처: Kaleido/Network.aset, Serial.aset
    # PID: Kp=15, Ki=0.07, Kd=0.06 (전 모델 동일)
    # Legacy(id=19)는 ArduinoTC4 드라이버로 미지원
    # -----------------------------------------------------------------------
    "kaleido": {
        "display_name": "Kaleido",
        "brand": "Kaleido",
        "models": ["M2", "M6", "M10", "M15", "M30", "Network", "Serial"],
        "protocol": "kaleido",
        "default_params": {
            "mode": "TCP",
            "host": "127.0.0.1",
            "port": 80,
            "path": "ws",
            "comport": "",
            "baudrate": 57600,
        },
        "pid": {"Kp": 15, "Ki": 0.07, "Kd": 0.06},
        "capabilities": ["heater", "fan", "drum"],
    },
    # -----------------------------------------------------------------------
    # Diedrich — MODBUS (CR/DR) + Phidget (Data Logging)
    # 출처: Diedrich/*.aset
    # PID: 없음
    # -----------------------------------------------------------------------
    # CR — TCP port=8010(비표준), RTU 115200
    # BT: register=0, ET: register=4, func=3(Holding), float=True(32-bit IEEE), unit_id=1
    # 주의: 값이 °F로 읽힘 → ModbusAdapter에서 °C 변환 필요
    "diedrich_cr": {
        "display_name": "Diedrich CR",
        "brand": "Diedrich",
        "models": ["CR"],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "125.135.119.211",
            "port": 8010,
            "comport": "",
            "baudrate": 115200,
            "modbus_registers": {
                "BT": {
                    "register": 0,
                    "func": 3,
                    "unit_id": 1,
                    "float": True,
                    "div": 0,
                    "mode": "F",
                },
                "ET": {
                    "register": 4,
                    "func": 3,
                    "unit_id": 1,
                    "float": True,
                    "div": 0,
                    "mode": "F",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # DR — CR과 레지스터 동일, default host만 다름
    "diedrich_dr": {
        "display_name": "Diedrich DR",
        "brand": "Diedrich",
        "models": ["DR"],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "192.168.251.202",
            "port": 8010,
            "comport": "",
            "baudrate": 115200,
            "modbus_registers": {
                "BT": {
                    "register": 0,
                    "func": 3,
                    "unit_id": 1,
                    "float": True,
                    "div": 0,
                    "mode": "F",
                },
                "ET": {
                    "register": 4,
                    "func": 3,
                    "unit_id": 1,
                    "float": True,
                    "div": 0,
                    "mode": "F",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # 4/6 Sensor Data Logging — id=34, Phidget 1048 사용
    "diedrich_phidget_4ch": {
        "display_name": "Diedrich 4-Sensor Data Logging",
        "brand": "Diedrich",
        "models": ["4 Sensor Data Logging"],
        "protocol": "phidget",
        "default_params": {
            "device_type": "1048",
            "channel_bt": 0,
            "channel_et": 1,
            "serial_number": None,
        },
        "pid": None,
        "capabilities": [],
    },
    "diedrich_phidget_6ch": {
        "display_name": "Diedrich 6-Sensor Data Logging",
        "brand": "Diedrich",
        "models": ["6 Sensor Data Logging", "6 Sensor Data Logging Pre-2018"],
        "protocol": "phidget",
        "default_params": {
            "device_type": "1048",
            "channel_bt": 0,
            "channel_et": 1,
            "serial_number": None,
        },
        "pid": None,
        "capabilities": [],
    },
    # -----------------------------------------------------------------------
    # Easyster — MODBUS (2개 항목)
    # 출처: Easyster/*.aset
    # PID: 없음
    # -----------------------------------------------------------------------
    # 2Temp, 3Temp, AirPressure — baudrate=9600, port=502
    # 핵심: BT와 ET가 같은 레지스터(1000)인데 unit_id(slave address)로 구분
    # BT: register=1000, func=4(Input), unit_id=1, div=1(÷10)
    # ET: register=1000, func=4(Input), unit_id=2, div=1(÷10)
    "easyster": {
        "display_name": "Easyster (Standard)",
        "brand": "Easyster",
        "models": ["2Temp", "3Temp", "AirPressure"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 9600,
            "stopbits": 2,
            "word_order": "big",
            "modbus_registers": {
                "BT": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
                "ET": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 2,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # Smart — host/port/baudrate 완전히 다름, 레지스터도 다름
    # BT: register=3, ET: register=4, func=3(Holding), unit_id=1, div=1(÷10)
    "easyster_smart": {
        "display_name": "Easyster Smart",
        "brand": "Easyster",
        "models": ["Smart"],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "192.168.0.2",
            "port": 3000,
            "comport": "",
            "baudrate": 115200,
            "modbus_registers": {
                "BT": {
                    "register": 3,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
                "ET": {
                    "register": 4,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # -----------------------------------------------------------------------
    # Proaster — MODBUS (2개 항목)
    # 출처: Proaster/*.aset
    # PID: 없음
    # -----------------------------------------------------------------------
    # 2Temp, 3Temp, AirPressure — Easyster와 레지스터 동일
    # BT: register=1000, func=4(Input), unit_id=1, div=1(÷10)
    # ET: register=1000, func=4(Input), unit_id=2, div=1(÷10)
    "proaster": {
        "display_name": "Proaster (Standard)",
        "brand": "Proaster",
        "models": ["2Temp", "3Temp", "AirPressure"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 9600,
            "stopbits": 2,
            "word_order": "big",
            "modbus_registers": {
                "BT": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
                "ET": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 2,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # THCR-01A — baudrate=38400, 레지스터 완전히 다름
    # BT: register=0, ET: register=2, func=4(Input), unit_id=1, div=0
    "proaster_thcr01a": {
        "display_name": "Proaster THCR-01A",
        "brand": "Proaster",
        "models": ["THCR-01A"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 38400,
            "word_order": "big",
            "modbus_registers": {
                "BT": {
                    "register": 0,
                    "func": 4,
                    "unit_id": 1,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
                "ET": {
                    "register": 2,
                    "func": 4,
                    "unit_id": 1,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # -----------------------------------------------------------------------
    # Trinitas — MODBUS (2개 항목: T2계열 / T7계열은 레지스터 맵이 완전히 다름)
    # 출처: TRINITAS/*.aset
    # PID: 없음
    # -----------------------------------------------------------------------
    # T2, T2_air, T2_legacy — func=4(Input), register=1000, unit_id로 BT/ET 구분
    # BT: unit_id=2 / ET: unit_id=1 (Easyster/Proaster와 unit_id 순서 반대!)
    "trinitas_t2": {
        "display_name": "Trinitas T2",
        "brand": "Trinitas",
        "models": ["T2", "T2 Air", "T2 Legacy"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 9600,
            "stopbits": 2,
            "modbus_registers": {
                "BT": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 2,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
                "ET": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 1,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # T7, T7_gas, T7_legacy — func=3(Holding), 단일 unit_id=3, 레지스터 분리
    # BT: register=1, ET: register=0, unit_id=3 (T2와 완전히 다른 구조)
    "trinitas_t7": {
        "display_name": "Trinitas T7",
        "brand": "Trinitas",
        "models": ["T7", "T7 Gas", "T7 Legacy"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "host": "127.0.0.1",
            "port": 502,
            "comport": "",
            "baudrate": 9600,
            "modbus_registers": {
                "BT": {
                    "register": 1,
                    "func": 3,
                    "unit_id": 3,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
                "ET": {
                    "register": 0,
                    "func": 3,
                    "unit_id": 3,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # -----------------------------------------------------------------------
    # Buja Roaster — MODBUS (4개 항목)
    # -----------------------------------------------------------------------
    "buja_smart_electric": {
        "display_name": "Buja Smart Electric",
        "brand": "Buja Roaster",
        "models": ["Smart Electric"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "comport": "",
            "baudrate": 9600,
            "bytesize": 8,
            "parity": "N",
            "stopbits": 2,
            "interval": 0.5,
            "modbus_registers": {
                "BT": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 1,
                    "float": False,
                    "div": 2,
                    "mode": "C",
                },
                "ET": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 2,
                    "float": False,
                    "div": 2,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    "buja_manual_hanyoung_nux": {
        "display_name": "Buja Manual (Hanyoung Nux)",
        "brand": "Buja Roaster",
        "models": ["Hanyoung Nux"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "comport": "",
            "baudrate": 9600,
            "bytesize": 8,
            "parity": "N",
            "stopbits": 1,
            "interval": 0.5,
            "modbus_registers": {
                "BT": {
                    "register": 0,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
                "ET": {
                    "register": 0,
                    "func": 3,
                    "unit_id": 2,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    "buja_manual_autonics": {
        "display_name": "Buja Manual (Autonics)",
        "brand": "Buja Roaster",
        "models": ["Autonics"],
        "protocol": "modbus",
        "default_params": {
            "mode": "rtu",
            "comport": "",
            "baudrate": 9600,
            "bytesize": 8,
            "parity": "N",
            "stopbits": 2,
            "interval": 0.5,
            "modbus_registers": {
                "BT": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
                "ET": {
                    "register": 1000,
                    "func": 4,
                    "unit_id": 2,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    "buja_smart_gas": {
        "display_name": "Buja Smart Gas",
        "brand": "Buja Roaster",
        "models": ["Smart Gas", "Smart Gas Control"],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "192.168.10.220",
            "port": 502,
            "interval": 0.5,
            "modbus_registers": {
                "BT": {
                    "register": 19,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
                "ET": {
                    "register": 20,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 1,
                    "mode": "C",
                },
                "heater": {
                    "register": 21,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
                "fan": {
                    "register": 22,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "div": 0,
                    "mode": "C",
                },
            },
        },
        "pid": None,
        "capabilities": [],
    },
    # -----------------------------------------------------------------------
    # Phidget — USB 센서 인터페이스 (범용)
    # 출처: Phidget/*.aset
    # PID: 없음 (읽기 전용)
    # -----------------------------------------------------------------------
    "phidget_tmp1101": {
        "display_name": "Phidget TMP1101 (4x TC)",
        "brand": "Phidget",
        "models": ["TMP1101"],
        "protocol": "phidget",
        "default_params": {
            "device_type": "TMP1101",
            "channel_bt": 0,
            "channel_et": 1,
            "serial_number": None,
        },
        "pid": None,
        "capabilities": [],
    },
    "phidget_tmp1200": {
        "display_name": "Phidget TMP1200 (1x RTD)",
        "brand": "Phidget",
        "models": ["TMP1200"],
        "protocol": "phidget",
        "default_params": {
            "device_type": "TMP1200",
            "channel_bt": 0,
            "channel_et": None,
            "serial_number": None,
        },
        "pid": None,
        "capabilities": [],
    },
    "phidget_1048": {
        "display_name": "Phidget 1048 (4x TC, USB)",
        "brand": "Phidget",
        "models": ["1048"],
        "protocol": "phidget",
        "default_params": {
            "device_type": "1048",
            "channel_bt": 0,
            "channel_et": 1,
            "serial_number": None,
        },
        "pid": None,
        "capabilities": [],
    },
    # -----------------------------------------------------------------------
    # Loring — MODBUS TCP (2개 항목: Smart Roast / Smart Roast Auto)
    # 출처: Loring/Smart_Roast.aset, Smart_Roast_Auto.aset
    # 모델: S7, S15, S35, S70, S135 (동일 프로토콜)
    # PID: 없음 (Loring 자체 PID 사용)
    # 주의:
    #   - 온도값은 BCD 인코딩 → ModbusAdapter에서 BCD 디코딩 후 div=1(÷10) 적용
    #   - 모든 온도 채널이 °F로 읽힘 → ModbusAdapter에서 °C 변환 필요
    #   - wordorderLittle=true (word order little-endian)
    #   - drum 채널은 bcd_as_int=true (BCD 값을 정수 그대로 읽음, % 단위)
    # -----------------------------------------------------------------------
    # Smart Roast (표준) — BT/ET + Inlet/Stack 온도 + Drum 속도
    # BT:    register=768, func=3(Holding), unit_id=1, bcd=true, div=1, mode=F
    # ET:    register=774, func=3, unit_id=1, bcd=true, div=1, mode=F
    # inlet: register=770, func=3, unit_id=1, bcd=true, div=1, mode=F
    # stack: register=772, func=3, unit_id=1, bcd=true, div=1, mode=F
    # drum:  register=778, func=3, unit_id=1, bcd_as_int=true, div=0 (%)
    "loring_smart_roast": {
        "display_name": "Loring Smart Roast",
        "brand": "Loring",
        "models": ["S7", "S15", "S35", "S70", "S135", "Smart Roast"],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "192.168.1.199",
            "port": 502,
            "comport": "COM5",
            "baudrate": 115200,
            "modbus_registers": {
                "BT": {
                    "register": 768,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "ET": {
                    "register": 774,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "inlet": {
                    "register": 770,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "stack": {
                    "register": 772,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "drum": {
                    "register": 778,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": False,
                    "bcd_as_int": True,
                    "div": 0,
                    "mode": "",
                },
            },
        },
        "pid": None,
        "capabilities": ["drum"],
    },
    # Smart Roast Auto — Smart Roast와 동일하나 자동 로스팅 상태 채널 추가
    # auto_status: register=284, func=2(Discrete Input), unit_id=1, div=0
    #   → 비트 0 = 자동 로스팅 활성 여부 (artisan: bit(0,x))
    "loring_smart_roast_auto": {
        "display_name": "Loring Smart Roast Auto",
        "brand": "Loring",
        "models": [
            "S7 Auto",
            "S15 Auto",
            "S35 Auto",
            "S70 Auto",
            "S135 Auto",
            "Smart Roast Auto",
        ],
        "protocol": "modbus",
        "default_params": {
            "mode": "tcp",
            "host": "192.168.1.199",
            "port": 502,
            "comport": "COM5",
            "baudrate": 115200,
            "modbus_registers": {
                "BT": {
                    "register": 768,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "ET": {
                    "register": 774,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "inlet": {
                    "register": 770,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "stack": {
                    "register": 772,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": True,
                    "div": 1,
                    "mode": "F",
                },
                "drum": {
                    "register": 778,
                    "func": 3,
                    "unit_id": 1,
                    "float": False,
                    "bcd": False,
                    "bcd_as_int": True,
                    "div": 0,
                    "mode": "",
                },
                "auto_status": {
                    "register": 284,
                    "func": 2,
                    "unit_id": 1,
                    "float": False,
                    "bcd": False,
                    "div": 0,
                    "mode": "",
                },
            },
        },
        "pid": None,
        "capabilities": ["drum"],
    },
}
