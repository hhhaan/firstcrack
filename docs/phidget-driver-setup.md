# Phidget 시스템 드라이버 설치

갱신일: 2026-11-09

Phidget USB 온도 센서(TMP1101, TMP1200, TMP1202, 1048)를 사용하는 로스터(Diedrich Data Logging 4ch/6ch 포함)는 **libphidget22 시스템 드라이버**가 필요하다.

`pip install Phidget22`(사이드카 requirements에 포함)만으로는 부족하다 — libphidget22는 USB 드라이버 자체라서 언어(Python/Rust) 무관하게 OS 레벨에 설치되어야 한다. 미설치 시 `src-tauri/sidecar/adapters/phidget.py`가 장치를 인식하지 못한다.

## 설치

**macOS**

[공식 macOS 안내](https://www.phidgets.com/docs/OS_-_macOS)의 Phidget Control Panel 설치 패키지를 사용한다. 구형 HID USB 장치는 macOS 확장 권한 승인이 필요할 수 있다. 모든 VINT 장치에 확장 승인이 필요한 것은 아니다.

**Windows**

[phidgets.com/docs/OS_-_Windows](https://www.phidgets.com/docs/OS_-_Windows) 에서 설치 패키지 다운로드.

**Linux (Ubuntu/Debian)**

```bash
curl -fsSL https://www.phidgets.com/downloads/setup_linux | bash
apt install libphidget22
```

드라이버 설치 후 앱을 재시작한다.

## 연결 전 확인

1. Phidget Control Panel에서 장치가 보이고 온도가 변하는지 확인한다. 모델, serial, VINT hub port, 프로브 채널 번호를 기록한다. VINT serial은 센서 모듈이 아닌 허브의 serial이다.
2. 연결한 프로브 종류를 확인한다. TMP1101/1048은 K·J·E·T 열전대, TMP1200/TMP1202는 PT100·PT1000 및 3850·3920 계수와 2·3·4선 배선을 앱에서도 동일하게 지정한다. 앱 기본값은 K형 또는 PT1000 3850/4선이며 패널 설정을 자동으로 가져오지 않는다.
3. Control Panel의 센서 테스트 창과 Artisan 등 장치를 사용하는 다른 앱을 닫는다.
4. First Crack에서 BT/ET별 모델·serial·hub port·채널·프로브를 지정한다. TMP1200/TMP1202는 RTD 입력 한 개(channel 0)다. 두 모듈로 BT/ET를 측정하면 각 hub port를 따로 지정한다. ET를 연결하지 않으면 ET 사용을 끈다.
5. 연결 테스트에서 실제 BT와 활성화한 ET 온도가 나오는지 확인한다. 같은 설정의 Artisan과 번갈아 비교하고 BT/ET 단선 및 USB 재연결을 확인한다. 모델·배선 오류를 온도 offset으로 덮지 않는다.

자동 주소는 일치하는 장치가 하나일 때만 연결한다. 여러 장치가 감지되면 serial/hub port를 지정한다. 초기 탐색은 1초로 제한되므로 느린 허브가 늦게 나타나면 다시 연결한다. 자동 재연결은 처음 선택한 주소를 유지한다. 모듈을 교체한 뒤에는 앱에서 명시적으로 새 연결을 시작한다.

ET 읽기만 실패하면 BT는 계속 수집하며 ET 표시·기록에는 빈 값이 남는다. BT 읽기 실패는 기존 stale/자동 재연결 경로를 사용한다. Phidget은 온도 읽기 전용이다.

> Phidget 하드웨어를 사용하지 않는 경우 이 단계는 불필요하다.

## TODO

- 사용자용 Nextra 문서 사이트에 이 내용 포팅 (Phidget 지원 로스터 섹션)
