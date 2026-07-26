"""
config.py — 사이드카 전역 상수.
실기기 튜닝 시 이 파일만 수정한다. 타이밍 값의 출처는 Artisan 코드베이스
(artisan/src/artisanlib/modbusport.py, s7port.py) 기준.
"""

# ── RoR / 평활화 ────────────────────────────────────────────────────────
# EMA 계수: 낮을수록 더 부드럽고 lag 증가 (0 < α < 1)
EMA_ALPHA = 0.2            # RoR 계산용
DISPLAY_ALPHA = 0.16       # 화면 표시용
ROR_WINDOW_SECS = 30.0     # RoR 최소제곱 슬라이딩 윈도우 길이
ROR_WARMUP_READS = 3       # 연결/Charge 후 RoR 표시 억제 read 횟수

# ── 장애 허용 ───────────────────────────────────────────────────────────
# read 실패 시 이전 값을 유지하는 허용 횟수 (Artisan acceptable_errors=3)
STALE_TOLERANCE_READS = 3
# 자동 재연결 백오프(초). 소진 후에는 마지막 값 간격으로 무한 재시도.
RECONNECT_BACKOFFS = [2.0, 5.0, 10.0]

# adapter.read() 전역 타임아웃(초). 드라이버가 응답하지 않아도 /temperatures가
# 무기한 pending 되지 않게 한다. 프론트 요청 타임아웃(5s)보다 짧아야 하고,
# 최악 케이스 RTU read(채널 3개 × retry ≈ 1.8s)보다는 길어야 한다.
READ_TIMEOUT = 3.0

# BT 유효 범위(°C). 벗어난 값은 "읽기 실패"로 간주해 stale/재연결 경로를 태운다.
# 어댑터가 실패를 예외가 아니라 -1.0 같은 센티넬로 인코딩하는 경우(Phidget 분리,
# Kaleido 핸드셰이크 유실, Probat 노드 누락)를 공통 경로에서 잡기 위한 것이다.
# 기준은 프론트 btFilter(src/features/active-roast/lib/btFilter.ts)와 동일하게 맞춘다:
#   하한 0   — 센티넬(-1.0)과 열전대 단선 시 0 판독을 배제.
#              (0°C 이하 환경의 콜드스타트는 지원 범위 밖 — 필요하면 이 값을 낮춘다)
#   상한 400 — 로스팅 BT 실측 상한 ~260, K타입 단선 시 1372 등 오판독을 배제.
# 센서는 튀고 드리프트하므로 실기기 튜닝 시 이 두 값만 조정한다.
BT_VALID_MIN_C = 0.0
BT_VALID_MAX_C = 400.0

# ── 프로토콜 타이밍 (Artisan 공식 값) ───────────────────────────────────
MODBUS_TCP_TIMEOUT = 0.25       # min(delay/2000, 0.4), delay=500ms 기준
MODBUS_RTU_TIMEOUT = 0.3        # 시리얼 응답 지연 여유
MODBUS_RTU_CONNECT_DELAY = 0.5  # modbus_serial_connect_delay
MODBUS_CLOSE_TIMEOUT = 1.0      # 불량 포트에서 close() 행 방지
S7_MIN_REQUEST_INTERVAL = 0.04  # PLC 과부하 방지 40ms

# ── 디버그 트레이스 ─────────────────────────────────────────────────────
# 링버퍼 항목 수. 5채널 × 2회/초 폴링(엔트리 3개/read) 기준 약 2~3분 분량.
TRACE_BUFFER_SIZE = 5000
