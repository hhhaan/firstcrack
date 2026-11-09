# Phidget 연결 준비와 추가 설치

갱신일: 2026-11-09

Phidget USB 온도 센서(TMP1101, TMP1200, TMP1202, 1048)를 사용하는 로스터(Diedrich Data Logging 4ch/6ch 포함)의 연결 준비 안내다. First Crack의 지원 OS는 macOS와 Windows다.

사이드카가 고정한 [Phidget22 1.25.20260408](https://pypi.org/project/phidget22/1.25.20260408/)의 macOS·Windows wheel에는 네이티브 라이브러리가 포함된다. `PhidgetSupport.py`는 패키지의 `.libs`를 먼저 읽고, `sidecar.spec`의 `collect_all`은 Phidget22 패키지를 수집한다. 따라서 Python 패키지만으로 무조건 부족하다거나 모든 사용자에게 시스템 라이브러리 별도 설치가 필요하다고 안내하지 않는다.

네이티브 라이브러리 번들과 OS 드라이버 확장은 별개다. macOS의 VINT·PHIDUSB 장치는 공식 Python 패키지 안내상 별도 설치가 필요 없지만, 1048 같은 구형 HID 장치는 아래 추가 설정이 필요하다. 이 번들 구성만으로 배포 앱의 모든 OS·아키텍처에서 실제 USB 연결을 검증한 것은 아니다.

## 기기와 OS별 준비

**macOS**

- TMP1101/TMP1200/TMP1202 등 VINT 장치: 일괄적인 시스템 라이브러리 별도 설치 단계는 없다. 장치 확인이나 문제 진단이 필요하면 [공식 macOS 안내](https://www.phidgets.com/docs/OS_-_macOS)의 Phidget Control Panel을 사용한다.
- 1048 등 HID USB 장치: 공식 안내의 macOS 라이브러리 또는 Standalone Control Panel을 설치하고 드라이버 확장을 허용한다. 현재 안내 경로는 시스템 설정 → 일반 → 로그인 항목 및 확장 프로그램 → 확장 프로그램이다. 이 권한은 구형 HID 장치용이며 모든 VINT 장치에 요구하지 않는다.

**Windows**

네이티브 라이브러리는 Python wheel에 포함된다. 장치 확인·문제 진단이나 추가 설치가 필요하면 [공식 Windows 안내](https://www.phidgets.com/docs/OS_-_Windows)에서 OS 아키텍처에 맞는 Control Panel 설치 패키지를 사용한다.

추가 설치·권한 변경 후 앱을 재시작한다. First Crack은 로컬 USB 연결만 사용하므로 Phidget Network Server를 켤 필요가 없다.

## 연결 전 확인

1. 장치 설정·진단에는 Phidget Control Panel을 권장한다. 사용한다면 장치가 보이고 온도가 변하는지 확인하고 모델, serial, VINT hub port, 프로브 채널 번호를 기록한다. VINT serial은 센서 모듈이 아닌 허브의 serial이다.
2. 연결한 프로브 종류를 확인한다. TMP1101/1048은 K·J·E·T 열전대, TMP1200/TMP1202는 PT100·PT1000 및 3850·3920 계수와 2·3·4선 배선을 앱에서도 동일하게 지정한다. 앱 기본값은 K형 또는 PT1000 3850/4선이며 패널 설정을 자동으로 가져오지 않는다.
3. Control Panel의 센서 테스트 창과 Artisan 등 장치를 사용하는 다른 앱을 닫는다.
4. First Crack에서 BT/ET별 모델·serial·hub port·채널·프로브를 지정한다. TMP1200/TMP1202는 RTD 입력 한 개(channel 0)다. 두 모듈로 BT/ET를 측정하면 각 hub port를 따로 지정한다. ET를 연결하지 않으면 ET 사용을 끈다.
5. 연결 테스트에서 실제 BT와 활성화한 ET 온도가 나오는지 확인한다. 같은 설정의 Artisan과 번갈아 비교하고 BT/ET 단선 및 USB 재연결을 확인한다. 모델·배선 오류를 온도 offset으로 덮지 않는다.

자동 주소는 일치하는 장치가 하나일 때만 연결한다. 여러 장치가 감지되면 serial/hub port를 지정한다. 초기 탐색은 1초로 제한되므로 느린 허브가 늦게 나타나면 다시 연결한다. 자동 재연결은 처음 선택한 주소를 유지한다. 모듈을 교체한 뒤에는 앱에서 명시적으로 새 연결을 시작한다.

ET 읽기만 실패하면 BT는 계속 수집하며 ET 표시·기록에는 빈 값이 남는다. BT 읽기 실패는 기존 stale/자동 재연결 경로를 사용한다. Phidget은 온도 읽기 전용이다.

> Phidget 하드웨어를 사용하지 않는 경우 이 단계는 불필요하다.
