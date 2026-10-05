# IKAWA 양방향 연동 조사

조사일: 2026-10-05. 범위: FC Desktop에서 실시간 읽기와 기기 쓰기를 모두 지원할 수 있는지. 실기기 테스트는 수행하지 않았다.

## 판정

- **Home: BLE로 실시간 상태 읽기 + 프로파일 쓰기를 구현한 공개 사례가 있다.** `libikawa`의 Python CLI는 상태 로깅, 현재 프로파일 조회, 프로파일 전송과 응답 확인을 구현한다. [CLI 소스](https://github.com/nkraetzschmar/libikawa/blob/main/cli.py)
- **Pro: 제3자 실시간 읽기는 Artisan에 구현되어 있다. 쓰기는 공식 앱에서 확인되지만 제3자 구현은 미검증이다.** Artisan은 HOME/PRO 전 모델의 BLE 로깅을 명시한다. 외부 개발자용 공식 SDK/API는 이번 조사에서 확인하지 못했다. [Artisan IKAWA 지원](https://artisan-scope.org/machines/ikawa/), [공식 앱 가이드](https://www.ikawacoffee.com/pro-app-guide/)
- Home 구현을 Pro50/Pro100/Pro100x에 그대로 적용할 수 있다고 판단하면 안 된다. FreeKAWA는 Home 실기기 검증과 Pro 미지원 범위를 명시한다. [FreeKAWA](https://github.com/tylergunderson/freekawa-web)

## 읽기와 쓰기의 범위

| 기능 | 공개 Home 구현의 근거 | Pro의 제3자 직접 연동 |
| --- | --- | --- |
| 실시간 온도·시간·상태 읽기 | CLI의 `MACH_STATUS_GET_ALL` 폴링 | Artisan BLE 구현 있음; FC 실기기 검증은 별도 |
| 팬·히터 관련 상태 읽기 | 상태 응답에 fan/heater/setpoint 등 필드 존재; 모델별 단위·의미 검증 필요 | Artisan이 목표 온도·히터·팬 RPM 등 로깅 명시 |
| 기기에 저장된 프로파일 읽기 | `PROFILE_GET` | 미검증 |
| 온도·팬 곡선 쓰기 | `PROFILE_SET`, 온도/팬 제어점 포함 | 공식 앱은 가능; 외부 구현 미검증 |
| 로스트 중 프로파일 변경 | FreeKAWA가 현재 시점에 즉시 반영될 수 있다고 명시 | 공식 Pro V3 브로셔에 지원 명시; 외부 구현 미검증 |
| 히터 출력·팬 출력을 독립적인 실시간 명령으로 설정 | 일반 로스팅용 명령으로 확인하지 못함 | 미검증 |
| 원격 시작·정지·냉각 | 공개 Home 명령 목록에서 확인하지 못함 | 미검증; 공식 가이드는 본체 버튼으로 예열 시작 |

상태 필드가 있다는 것과 해당 값을 쓸 수 있다는 것은 다르다. `SETTING_SET`, `START_TEST` 및 히터/팬 진단 항목도 일반 로스팅용 출력 제어 API로 간주하지 않는다. [프로토콜 스키마](https://github.com/nkraetzschmar/libikawa/blob/main/ikawa.proto), [CLI](https://github.com/nkraetzschmar/libikawa/blob/main/cli.py), [FreeKAWA의 로스트 중 변경 설명](https://github.com/tylergunderson/freekawa-web), [공식 시작 절차](https://www.ikawacoffee.com/pro-app-guide/), [Pro V3 브로셔](https://www.ikawacoffee.com/wp-content/uploads/2020/04/IKAWA_PROV3_Brochure_2020.pdf)

Artisan 소스는 `PROFILE_SET=16` 상수를 선언하지만 실제 `requestDataMessage()`는 상태 조회 명령 `MACH_STATUS_GET_ALL_VALUE=11`만 보낸다. 상수의 존재를 Pro 쓰기 구현의 증거로 해석하지 않는다. [Artisan BLE 소스](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/ikawa.py#L356)

따라서 “쓰기”가 **목표 온도·팬 프로파일 전송**이면 Home에는 근거가 있다. **수동 히터 %·팬 % 제어와 원격 시작/정지**까지 요구하면 Home도 충족 여부를 확정할 수 없다.

## 확인된 Home 전송 방식

BLE GATT → 자체 프레임 → Protobuf 요청/응답 구조다. 아래 UUID는 Home 분석과 Artisan HOME/PRO BLE 구현에서 동일하게 확인된다. UUID가 같아도 프로파일 쓰기 호환성은 별도 검증이 필요하다. [Artisan BLE 소스](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/ikawa.py#L371)

| 항목 | 값 |
| --- | --- |
| Service | `C92A6046-6C8D-4116-9D1D-D20A8F6A245F` |
| Write characteristic | `851A4582-19C1-4E6C-AB37-E7A03766BA16` |
| Notify characteristic | `948C5059-7F00-46D9-AC55-BF090AE066E3` |

프레임은 `0x7E` 구분자, escape, CRC16을 사용하고 요청/응답은 sequence 번호로 연결된다. 분석된 기기는 20바이트 단위로 송수신하므로 분할 전송과 수신 재조립이 필요하다. `libikawa` 분석은 Home 앱 2.1.6과 단일 기기 펌웨어 `25.17-g1925d8d-DIRTY` 기반이며 Pro는 평가하지 않았다. [프로토콜 분석](https://github.com/nkraetzschmar/libikawa/blob/main/ikawa_protocol.md), [Python 전송 구현](https://github.com/nkraetzschmar/libikawa/blob/main/libikawa.py)

## FC Desktop 구현 방향 — 제안

기존 Python sidecar에서 **Bleak + Protobuf로 BLE 어댑터를 구현**하는 방식이 적합하다. `libikawa`는 이미 Bleak을 사용하고, Bleak은 macOS/Windows/Linux의 BLE 연결·쓰기·notification을 지원한다. 브라우저용 FreeKAWA 구현은 프로토콜 참고 자료로 활용한다. [libikawa](https://github.com/nkraetzschmar/libikawa/blob/main/libikawa.py), [Bleak 공식 문서](https://bleak.readthedocs.io/en/latest/), [FreeKAWA 패키지](https://github.com/tylergunderson/freekawa-node)

읽기 상태와 프로파일 전송을 별도 capability로 취급한다. 프로파일 쓰기는 응답 확인 후 재조회하여 실제 저장값을 대조하고, 재연결 때 쓰기 명령을 자동 재실행하지 않는 설계를 제안한다. 실시간 수동 출력 제어는 검증 전 활성화하지 않는다. 이는 공개 구현의 지원 범위에 맞춘 설계 제안이다.

Pro 대상이라면 다음 순서로 검증해야 한다.

1. 정확한 모델·펌웨어를 확정하고 IKAWA에 제3자 양방향 SDK/프로토콜 제공 여부와 제어 범위를 문의한다.
2. 실기기 GATT 서비스/특성을 조회하여 Home UUID 및 프레임과의 호환성을 확인한다.
3. 기기 식별·프로파일 schema·상태 조회부터 검증한다. Home의 필드명만으로 센서 의미를 추정하지 않는다.
4. 지원되는 프로파일을 전송하고 ACK 및 재조회 일치를 확인한다.
5. 시작·정지·냉각 및 수동 출력 제어가 필요하면 공식 앱 통신 또는 제조사 문서로 각각 검증한다.
6. macOS arm64/x86_64, Windows에서 BLE 권한·패키징·연결 끊김·공식 앱과의 연결 충돌을 실기기로 검증한다.

## 요건을 충족하지 않는 경로

- **Cropster 연동:** 공식 설명은 IKAWA 앱에서 Cropster로 로스트 기록을 전송하는 기능이다. 로스터에 명령을 쓰는 경로로 확인되지 않았다. 페이지의 beta 표기는 현재 제공 상태를 확정하는 근거로 쓰지 않는다. [IKAWA 공식 설명](https://www.ikawacoffee.com/cropster/)
- **Artisan 로깅 및 CSV/프로파일 파일 교환:** Artisan은 직접 BLE 읽기도 지원하지만 쓰기 구현의 근거는 없다. 사후 파일 연동만으로도 양방향 요건은 충족하지 못한다. [Artisan 공식 지원 범위](https://artisan-scope.org/machines/ikawa/)
- **USB-C:** Pro100x 공식 브로슈어는 모바일 기기 충전용 Power Out으로 설명한다. USB 제어 프로토콜의 근거가 없다. [공식 브로슈어](https://www.ikawacoffee.com/wp-content/uploads/2023/10/IKAWA_Pro100x-Digital-Brochure.pdf)

## 결론

Home은 **실시간 읽기 + 프로파일 쓰기** PoC를 시작할 근거가 충분하다. Pro는 **읽기 구현을 참고할 수 있지만 쓰기에 실기기/제조사 확인이 필요한 연동**이다. 모든 IKAWA 모델에 대해 양방향 지원을 약속하거나 수동 히터·팬 제어까지 지원한다고 표현할 단계는 아니다.
