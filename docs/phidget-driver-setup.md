# Phidget 시스템 드라이버 설치

작성일: 2026-07-19

Phidget USB 온도 센서(TMP1101, TMP1200, 1048)를 사용하는 로스터(Diedrich Data Logging 4ch/6ch 포함)는 **libphidget22 시스템 드라이버**가 필요하다.

`pip install Phidget22`(사이드카 requirements에 포함)만으로는 부족하다 — libphidget22는 USB 드라이버 자체라서 언어(Python/Rust) 무관하게 OS 레벨에 설치되어야 한다. 미설치 시 `src-tauri/sidecar/adapters/phidget.py`가 장치를 인식하지 못한다.

## 설치

**macOS**

```bash
brew install phidget22
```

또는 [phidgets.com/docs/OS_-_macOS](https://www.phidgets.com/docs/OS_-_macOS) 에서 설치 패키지 다운로드.

**Windows**

[phidgets.com/docs/OS_-_Windows](https://www.phidgets.com/docs/OS_-_Windows) 에서 설치 패키지 다운로드.

**Linux (Ubuntu/Debian)**

```bash
curl -fsSL https://www.phidgets.com/downloads/setup_linux | bash
apt install libphidget22
```

드라이버 설치 후 앱을 재시작하면 Phidget 장치가 자동으로 인식된다.

> Phidget 하드웨어를 사용하지 않는 경우 이 단계는 불필요하다.

## TODO

- 사용자용 Nextra 문서 사이트에 이 내용 포팅 (Phidget 지원 로스터 섹션)
