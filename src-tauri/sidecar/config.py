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
# snap7 connect 전 TCP 프로브 상한. Artisan isOpen()은 0.3s — 무선/VLAN 여유로 1s.
# snap7 Cli_ConnectTo는 도달 불가 호스트에서 커널 SYN 타임아웃(macOS 75s)까지
# 블로킹되고 PingTimeout으로도 못 끊는다(실측) — 이 프로브가 유일한 상한이다.
S7_PROBE_TIMEOUT_S = 1.0

# ── S7 I/O 예산 ─────────────────────────────────────────────────────────
# manager의 wait_for(READ_TIMEOUT)는 코루틴만 풀어주고 snap7 동기 호출이 도는
# executor 스레드는 중단시키지 못한다. 그 스레드가 _io_lock을 오래 쥐면 재연결
# disconnect가 락 대기열 뒤에 줄을 서 백오프와 무관하게 지연된다.
# → 읽기 경로 전체를 벽시계 예산으로 묶어 "스레드가 wait_for 만료 전에 반드시
#   락을 놓는다"를 보장한다 (좀비 스레드가 생기지 않는 조건).
S7_RECV_TIMEOUT_MS = 500          # snap7 RecvTimeout. 기본 3000 → 하향
S7_READ_BUDGET_S = 2.0            # _read_all 진입~반환 벽시계 예산(락 대기 포함)
S7_IO_LOCK_TIMEOUT_S = 0.5        # 읽기/쓰기 락 획득 상한 — 실패 = 읽기 실패로 승격
S7_TEARDOWN_LOCK_TIMEOUT_S = 3.0  # connect 바인딩/disconnect 락 상한(최악 read보다 커야 함)
# 관계식: 마지막 시도는 예산 만료 직전에 시작될 수 있으므로
#   최악 = S7_READ_BUDGET_S + S7_MIN_REQUEST_INTERVAL + S7_RECV_TIMEOUT_MS/1000
#        = 2.0 + 0.04 + 0.5 = 2.54s < READ_TIMEOUT(3.0)
# 여유 0.46s가 좀비 방지 마진이다. 어느 값을 손대든 이 부등식을 먼저 확인할 것.

# ── 소프트웨어 PID / 제어 안전 ──────────────────────────────────────────
# tick 주기(초). Artisan이 Giesen 프로파일에서 쓰는 샘플 주기와 같다(Delay=1000).
# 프론트 폴링 주기와 분리한다 — 폴링은 idle에서 멈추지만 제어 루프는 멈추면 안 된다.
PID_TICK_S = 1.0

# PV가 이보다 오래되면 HOLDING(쓰기 중단, 적분 동결)으로 내려간다.
# 옛 온도로 화력을 계산하는 것보다 마지막 duty를 유지하는 편이 안전하다.
PID_PV_MAX_AGE_S = 3.0
# HOLDING이 이보다 길어지면 FAULT — 언제 돌아올지 모르는 센서를 믿고 불을 켜둘 수 없다.
PID_HOLD_TIMEOUT_S = 5.0

# 연속 쓰기 실패 허용 횟수. 1~2회는 재시도하고 상태를 바꾸지 않는다(일시적 PLC 지연).
PID_WRITE_FAIL_LIMIT = 3
# FAULT 진입 시 heater 0 쓰기 시도 횟수. S7은 요청 간 40ms 스로틀이 있어 자연히 간격이 생긴다.
PID_SAFE_OFF_RETRIES = 3

# 사용자가 지정할 수 있는 SV 범위(°C). 로스팅 BT 실측 범위 기준.
PID_SV_MIN_C = 50.0
PID_SV_MAX_C = 250.0

# BT가 이 값을 넘으면 즉시 FAULT + heater 0. BT_VALID_MAX_C(400, 오판독 배제용)와
# 달리 이건 "정상 판독이지만 너무 뜨겁다"는 컷아웃이다. 실기 튜닝 대상.
SAFETY_MAX_BT_C = 260.0

# PID tick이 프론트 폴링 표본을 재사용할 수 있는 최대 나이(초).
# 폴링(0.5~1s)보다 넉넉해 대개 하드웨어 왕복이 한 번으로 합쳐진다.
READING_MAX_AGE_S = 1.5

# duty 변화가 이보다 작으면 쓰지 않는다(불필요한 PLC 쓰기 억제).
PID_DUTY_DEADBAND = 1.0
# 변화가 없어도 이 tick 수마다 한 번은 다시 쓴다 — 머신이 값을 잃었을 때 복구용.
PID_RESEND_EVERY_N_TICKS = 3

# ── 디버그 트레이스 ─────────────────────────────────────────────────────
# 링버퍼 항목 수. 5채널 × 2회/초 폴링(엔트리 3개/read) 기준 약 2~3분 분량.
TRACE_BUFFER_SIZE = 5000
