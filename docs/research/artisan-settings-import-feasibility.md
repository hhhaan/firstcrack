# Artisan 로컬 설정 자동 가져오기 가능성

조사일: 2026-10-10. 대상은 **macOS의 머신 연결·센서 주소·그래프·이벤트 설정**이다. 로스팅 프로파일(`.alog`), 이력, 계정은 제외한다. 공식 소스의 현재 master를 `548036e7ff516dfeae6e6f84d0dfea97f3f70fe3`으로 고정해 조사했다. 아래는 구현 계획이며 완성된 importer나 실기기 검증 결과가 아니다.

## 결론과 로컬 확인

자동 발견·읽기는 가능하다. Firescope의 IndexedDB와 달리 macOS plist를 읽는 경로로 시작할 수 있다. 다만 **native 설정은 기본값을 생략하므로, 읽힌 키만으로 전체 머신 설정이 확정되지는 않는다.** `.aset` 내보내기는 자동 발견 실패 시 선택적 대안이다.

이 Mac에서 읽기 전용으로 확인한 사실:

- `~/Library/Preferences/org.artisan-scope.Artisan.plist`가 존재하며 Python `plistlib`로 파싱된다. 총 94개 키이고 scalar, list, dict, bytes가 섞여 있다.
- 허용한 키만 확인했을 때 `Device.id=29`, `Mode=C`, Modbus FC4·주소 1000·소수점 배율 1 설정이 있다. `Colors`는 dict이다. 원본 전체, 포트 식별자, 계정값은 출력하거나 복사하지 않았다.
- `Modbus.type`, signed 플래그, `System/artisan_version`은 저장되어 있지 않다. **RTU나 unsigned라고 확정하지 않는다.** 현재 소스의 기본값 생략 정책과 양립하지만 이 plist를 쓴 버전은 미확인이다.
- `/Applications/Artisan.app`, `~/Applications/Artisan.app`에는 앱이 없다. 다른 위치의 설치 여부는 조사하지 않았다. Viewer와 아래 legacy plist도 없다.
- 앱 실행·설정 수정·장비 연결은 하지 않았다. 저장 파일을 발견했다는 사실은 현재 실행 중 설정이나 현재 로스터를 입증하지 않는다.
- 같은 날 추가 allowlist 확인: `ExtraDev.extradevices=[33]`이 있으며, `Axis.xmin/xmax/ymin/ymax/zmin/zmax`, `BTfunction`, `ETfunction`, `ChannelTares`는 없다. `Colors`는 dict다. 이 파일은 추가 device가 없는 단순 BT/ET fixture가 아니며, 누락된 키로 축 범위·보정 없음까지 확정하지 않는다. 추가 device ID의 의미와 표시 역할도 버전별 확인 대상이다.

## 자동 발견과 저장 형식

공식 식별자는 organization `artisan-scope`, domain `artisan-scope.org`, application `Artisan`; Viewer는 `ArtisanViewer`로 별도다. [공식 util.py](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/util.py#L53-L58)

| 후보 | 처리 |
|---|---|
| `~/Library/Preferences/org.artisan-scope.Artisan.plist` | 현대 Artisan 기본 native 후보 |
| `~/Library/Preferences/org.artisan-scope.ArtisanViewer.plist` | Viewer 설정; 기본 제외 |
| `~/Library/Preferences/com.google.code.p.Artisan.plist` | v1.5 식별자에서 유도한 legacy 후보; 현대 설정과 섞지 않음 |

macOS 경로는 Qt의 CFPreferences 규칙으로 유도하며 이 Mac에서는 첫 경로의 존재까지 확인했다. 사용자 홈은 플랫폼 API로 구한다. QSettings는 앱/조직 및 사용자/시스템 fallback이 있으므로 단일 plist를 읽은 결과를 전체 effective preferences라고 부르지 않는다. [Qt QSettings 플랫폼 설명](https://doc.qt.io/qt-6/qsettings.html#platform-specific-notes), [v1.5.0 공식 소스](https://github.com/artisan-roaster-scope/artisan/blob/v1.5.0/src/artisanlib/main.py)

Qt macOS backend는 키의 `/`, `.`, middle-dot을 변환한다. 실제 로컬 키 `Modbus.input1register`는 QSettings의 `Modbus/input1register`에 대응한다. 모든 점을 무조건 슬래시로 바꾸는 일반 변환 대신 지원할 키를 명시적으로 매핑한다. plist의 bytes를 임의 Python 객체나 실행 가능한 데이터로 역직렬화하지 않는다. CFPreferences 캐시·host별 도메인과 파일의 최신성 차이는 별도 검증 대상이다. [Qt macOS backend](https://github.com/qt/qtbase/blob/dev/src/corelib/io/qsettings_mac.cpp)

Artisan의 native 저장은 `QSettings()`이며 기본값과 다른 항목만 남긴다. `.aset`는 `QSettings(filename, IniFormat)`으로 전체 설정을 저장하고 `System` 버전 정보를 추가한다. 일반 설정 파일 로드는 `Mode` 키를 요구한다. 따라서 `.aset`는 JSON이나 profile 파일이 아니며 표준 INI parser만으로 Qt의 타입·escape를 모두 재현할 수 있다고 가정하면 안 된다. [저장 구현](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/main.py#L20071-L20165), [로드 구현](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/main.py#L17873-L17910), [Qt INI 형식](https://doc.qt.io/qt-6/qsettings.html#Format-enum)

공식 Help 메뉴의 설정 저장/로드는 여러 로스터 설정을 전환하는 기능이다. native 파일 하나는 저장된 현재 구성 후보이며, 최근 `.aset` 경로 목록을 자동으로 순회해 모든 머신을 복구하는 근거는 아니다. [공식 Setup](https://artisan-scope.org/docs/setup/#settings--load-load-recent-save)

## 추출 스키마와 FC 매핑

아래 키는 QSettings 표기다. 데이터가 있는 것과 FC에서 같은 동작으로 사용할 수 있는 것은 구분한다.

| 소스 키/영역 | 초기 처리 |
|---|---|
| `Device/id`, `ExtraDev/extradevices` | 실제 선택 device 및 추가 채널 확인. Modbus 키가 남아 있다는 이유만으로 active Modbus 판정 금지 |
| `Modbus/type`, `comport`, `baudrate`, `bytesize`, `parity`, `stopbits`, `host`, `port` | 알려진 버전에서만 transport/default 복원 |
| `Modbus/inputNdeviceId`, `inputNregister`, `inputNcode`, `inputNdiv`, `inputNmode`, 타입 플래그, `wordorderLittle` | 읽기 주소·해석 후보. 구버전 `inputNslave`와의 우선순위 검증 |
| `S7/host`, `port`, `rack`, `slot`, `area`, `db_nr`, `start`, `type`, `mode`, `div` | 배열 길이·역할·area enum 검증 후 후보 생성 |
| `Mode`, `Axis/xmin,xmax,ymin,ymax`, `Colors` | 단위 확인 후 표시 범위·지원 색상만 변환 |
| `BTfunction`, `ETfunction`, `ChannelTares`, `events`, `Alarms`, `Sliders` | 영향 탐지 및 보류 표시. 계산식·명령·제어 자동 적용 금지 |

키의 읽기와 기본값 사용은 [settingsLoad](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/main.py#L18090-L19135)에 있다. 사전 목록 전체를 복사하기보다 필요한 키만 allowlist로 읽는다. 계정, 최근 파일, batch, 창 위치, 외부 프로그램은 결과에 포함하지 않는다.

### Modbus: 가장 작은 머신 구현 후보

Artisan transport enum은 `0=RTU`, `1=ASCII`, `3=TCP`, `4=UDP`이며 `2=Serial Binary` 경로는 현재 비활성이다. unsigned 기본값, signed 플래그, float/BCD/32-bit integer 관련 별도 플래그와 word order가 있다. [modbusport.py](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/modbusport.py#L115-L181), [연결 구현](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/modbusport.py#L307-L372)

일반 Modbus/S7 device의 반환 경로는 **input 1 → BT, input 2 → ET**다. 단순히 채널 배열 순서를 ET/BT로 가정하면 뒤집힌다. 추가 device와 symbolic BT/ET가 있으면 이 단순 매핑을 그대로 적용하지 않는다. Artisan은 디코딩 후 `processChannelData`에서 scale/unit 처리를 한다. [comm.py의 Modbus/S7 반환](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/comm.py#L1525-L1533), [Modbus wrapper](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/comm.py#L1654-L1674), [채널 처리](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/comm.py#L3162-L3255)

FC `custom_modbus`로 초기 지원할 범위는 transport가 확정되고, 일반 BT/ET·FC3/4·16-bit integer·div 0/1/2·C/F·명시적 signed 해석이 동등한 경우다. float/BCD/32-bit·word order는 FC adapter가 일부 처리하더라도 **편집→재저장→연결 round-trip**까지 확인 전 보류한다. ASCII는 Modbus ASCII이며 임의 텍스트 serial이 아니다. read register를 `write_map`으로 바꾸지 않는다. [FC Modbus adapter](../../src-tauri/sidecar/adapters/modbus.py), [FC 주소 편집](../../src/entities/machine/addressMap.ts)

### S7 및 그 밖의 연결

S7의 `area=0`은 비활성이고 읽을 때 area에서 1을 뺀다. type은 INT/FLOAT 외 FLOAT2INT 및 bit 타입도 있다. FC enum에 raw 숫자를 그대로 복사하면 안 된다. 초기에는 DB INT/REAL과 역할·단위·scale가 검증된 조합만 지원한다. [Artisan S7 구조](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/s7port.py#L60-L76), [읽기 변환](https://github.com/artisan-roaster-scope/artisan/blob/548036e7ff516dfeae6e6f84d0dfea97f3f70fe3/src/artisanlib/comm.py#L3162-L3183), [FC S7 adapter](../../src-tauri/sidecar/adapters/s7.py)

| 방식 | FC 실행 경로 기준 판단 |
|---|---|
| Modbus RTU/ASCII/TCP/UDP | 활성 adapter 있음; 위 의미 검증 필요 |
| Siemens S7 | 활성 adapter 있음; area/type/role/unit 별도 매핑 |
| Phidget | 활성 온도 adapter 있음. Artisan의 hub·thermocouple/RTD·remote·formula 전체 설정과 동등하지 않음 |
| 일반 Serial text, MQTT, BLE, USB HID | 범용 importer 대상으로 연결할 활성 adapter 없음 |
| Probat/Kaleido 등 전용 protocol | FC 구현이 있어도 source device·handshake·payload 동등성이 확인될 때만 매핑 |

지원 판정은 [FC factory](../../src-tauri/sidecar/adapters/__init__.py), [registry](../../src-tauri/sidecar/roaster_registry.py), [Phidget adapter](../../src-tauri/sidecar/adapters/phidget.py)의 실제 경로 기준이다. 의존 라이브러리나 `extern` 파일의 존재는 범용 연결 지원이 아니다.

### 그래프와 이벤트

초기는 온도 단위·축 범위·BT/ET/RoR 색상 정도가 적절하다. `Axis/xmin`이 음수이거나 자동 축 모드이면 FC의 단순 시간 범위와 완전히 같지 않으므로 보류 항목을 표시한다. 단위는 원본 해석값과 FC 표시 단위를 분리해 보여준다. [Artisan Axes](https://artisan-scope.org/docs/axes/), [FC 그래프 설정](../../src/features/active-roast/model/settings.ts)

이벤트에는 라벨·시각표현뿐 아니라 버튼 동작·슬라이더·자동 감지·알람이 섞인다. 이름이 비슷한 설정을 FC 자동 감지/PID/제어에 자동 이식하지 않는다. 추가 센서값과 제어 명령도 분리한다. [Artisan Events](https://artisan-scope.org/docs/events/), [공식 symbolic/extra-device 설명](https://artisan-scope.org/docs/setup/#configure-for-extra-devices-beyond-two)

## 최소 구현 순서와 검증 조건

1. **자동 발견**: 현대 native plist를 우선 탐색. 앱 실행 없이 크기 제한·symlink 정책·읽기 전후 stat/hash를 적용한다. 실행 중/변경 중이면 저장된 snapshot임을 알리거나 재검색을 요청한다. 파일 snapshot은 CFPreferences effective 값 재현과 구분한다.
2. **제한 추출**: Python 표준 `plistlib`로 scalar/list/dict만 읽고 위 allowlist와 길이·숫자 범위를 검사한다. 알 수 없는 QVariant bytes는 해석하지 않는다. endpoint로 접속하거나 shell/Artisan 코드를 실행하지 않는다.
3. **기본값 증거**: native 파일에는 export 전용 버전 정보가 없는 것이 정상일 수 있다. 앱 bundle의 버전도 마지막 작성 버전의 확정 증거는 아니다. 지원 release별 기본값 표와 변화 검사를 만들고, 증거가 부족한 머신은 필요한 항목 확인 전 적용하지 않는다.
4. **미리보기**: 머신 미선택으로 시작. 사용자용 연결명·BT/ET·가져오기 가능/확인 필요를 표시한다. 원본 키·주소 목록은 가져오기 화면에 노출하지 않는다. 누락·미지원 값을 FC default로 조용히 대체하지 않는다. source 파일을 덮어쓰지 않는다.
5. **적용**: 동등성이 검증된 custom 머신만 새로 추가하고 provenance·중복·플랜 한도를 확인한다. 기존 머신, write_map, PID, 이벤트 동작은 유지한다. 그래프는 별도 선택하고 저장 실패/부분 성공을 구분한다.
6. **선택적 fallback**: native 없음/버전 불명/Qt 타입 미지원 시 사용자가 선택한 `.aset`만 읽는다. `.alog`나 CSV 가져오기를 설정 가져오기의 대안으로 제시하지 않는다.

출시 전 필요한 검증: 여러 Artisan release의 기본값/키 변경, native와 `.aset`의 같은 설정 대조, Qt 키·타입 fixture, CFPreferences cache와 앱 실행 중 snapshot, BT/ET·extra device·symbolic 변환, FC 편집 round-trip, frozen arm64/x86_64. 실제 Artisan 실행 화면과 하드웨어 값의 동등성은 이번 조사에서 검증하지 않았다.
