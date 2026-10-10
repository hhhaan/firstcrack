# Cropster·Firescope·Artisan 로스팅 설정 import 가능성

조사일: 2026-10-10 · 관련 이슈: [#710](https://github.com/hhhaan/firstcrack/issues/710)

범위는 머신 연결과 로스팅 그래프·이벤트 설정이다. 프로파일, 히스토리, 재고, 계정·인증 정보는 제외한다. 이번 결과물은 조사 문서이며, FC importer 구현이나 설정 적용은 수행하지 않았다.

## 판정

| 제품 | 확인한 입력 경로 | 이번에 확인한 것 | 아직 확인하지 못한 것 |
|---|---|---|---|
| Firescope 1.0.2 | 로컬 Chromium IndexedDB `ngStorage` / object store `localStorage` | 설치본 코드와 DB 복사본에서 그래프 설정·머신 캐시 객체 해독 | 브라우저의 현재 논리값과 대조, 버전·OS 호환성, 실제 연결 |
| Cropster RI 5.13 | Java Preferences + 데이터 폴더 루트의 `preferences.json`, `machine.json` | Linux 배포본의 경로 생성·읽기·쓰기·JSON 필터 코드 | 설정된 사용자 파일, 활성 머신·설정 우선순위, Windows/macOS 배포본 |
| Artisan | Help → Save Settings → `.aset` | 공식 설정 export와 QSettings INI 저장 코드 | 실제 사용자 export의 FC 변환·연결 |

**설정을 추출할 경로는 세 제품 모두 있다. Firescope는 한 설치본에서 실제 객체 추출까지 확인했고, Cropster는 저장 코드까지 확인했다. FC에 모든 설정을 동일하게 적용할 수 있다는 결론은 아직 아니다.** Artisan은 vendor가 제공하는 설정 파일을 입력으로 삼을 수 있다. [Artisan 공식 설정 안내](https://artisan-scope.org/docs/setup/), [Cropster 공식 Preferences](https://help.cropster.com/customization-and-preferences/roasting-intelligence-preferences)

## #710에서 수정할 결론

1. **Firescope 값의 이중 JSON 파싱을 고정하지 않는다.** 이번 DB는 IndexedDB/V8 디코딩 후 `dict`로 나왔다. 추가 JSON 파싱은 0회였다. 먼저 Chromium 값을 정상 해독하고, 문자열일 때만 확인된 버전의 직렬화 방식대로 처리한다. 문자열 검색 과정에서 보인 JSON escaping은 실제 저장 타입의 증거가 아니다. 근거: 아래 F1·F2와 [Chromium 직렬화 명세](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md).
2. **로그에 남은 실제 머신이 현재 활성 머신이라는 보장은 없다.** 머신 키에서 21개 레코드를 복구했다. 최고 sequence는 `DummyDriver` 데모 머신이고, 실제 `ModbusDriver` 설정 6개는 이전 레코드였다. 과거 실제 머신을 최신 머신 대신 자동 선택하면 안 된다. 근거: F2.
3. **Cropster의 루트 파일부터 조사한다.** RI 5.13은 `<dataDirectory>/preferences.json`, `machine.json`을 저장하고 outbox로 복사한다. outbox만 필수 입력으로 삼거나 `**/*.json` 전체를 가져올 이유가 없다. 근거: C1의 `StorageServiceImpl.savePreferences`.
4. **Roast curve import는 설정 import의 근거가 아니다.** [#56의 Artisan `.alog`](https://github.com/hhhaan/firstcrack/issues/56)와 [#57의 Firescope CSV](https://github.com/hhhaan/firstcrack/issues/57)는 로스팅 기록 이관이고, 이번 조사와 입력 계약이 다르다. Artisan 설정은 `.aset`이다. [Artisan 유지보수자 설명](https://github.com/artisan-roaster-scope/artisan/discussions/1158)

## 로컬 증거와 재현 범위

원본 앱과 DB는 읽기만 했다. Firescope가 실행 중이지 않음을 프로세스 목록으로 확인하고, IndexedDB 폴더를 임시 디렉터리에 복사했다. 설정 키만 결과에 출력했으며, 원본 파일의 SHA-256이 복사 전후·해독 후 동일함을 확인했다. 임시 DB 복사본은 삭제했고 실제 DB·앱 바이너리는 레포에 넣지 않았다. Cropster 앱이나 연결된 로스터는 실행하지 않았다.

| ID | 자료 | 식별 정보 |
|---|---|---|
| F1 | `/Applications/Firescope.app/Contents/Resources/app.asar` | package `desktop`, productName `Firescope`, version `1.0.2`; SHA-256 `c842c66bc851cb5a21eee7a06148334760ddee8ff84089d7f89250276ddbdff1` |
| F2 | Firescope `IndexedDB/file__0.indexeddb.leveldb` 복사본 | `CURRENT → MANIFEST-000001`; 활성 table `000062.ldb`, WAL `000060.log`; comparator `idb_cmp1`; 남은 데이터 파일과 활성 파일 목록 일치 |
| C1 | 이전 조사에서 내려받아 둔 Linux RI 5.13 `.deb`와 JAR | `.deb` SHA-256 `8e5ae468c6c1ed3898d3b9728996464916988ed7dda201b942bb797913c73500`; `roastingintelligence-5.13.jar` SHA-256 `9f7a07242b208833e584758aad684193d819d0476d815bcd9a1e021b49b1c1f6` |

F2 해독에는 조사용 임시 Python 환경에서 [ccl_chromium_reader](https://github.com/cclgroupltd/ccl_chromium_reader/tree/ef840de30221c4d65bc96d2f4d9057e9ef2f526d) 0.3.18을 사용했다. DB 이름 `ngStorage`, origin `file__0@1`, object store `localStorage`를 확인하고, 키별 최고 `ldb_seq_no`를 삭제 레코드까지 포함해 선택한 뒤 `is_live`를 검사했다. 별도로 CURRENT가 지정한 MANIFEST의 table 추가·삭제와 WAL 번호를 확인해 orphan 파일이 없음을 검사했다.

이는 **이 복사본의 최고 sequence를 확인한 결과**다. 네이티브 IndexedDB API가 반환하는 현재 값과 UI 대조까지 수행한 것은 아니다. 이 라이브러리는 오래된·삭제된 레코드도 반환하며, `live_only`만으로 최신 값을 보장하지 않는다. 또한 이번 온도 단위 `°C`는 일부 결과에서 `b'\xb0C'`로 나왔다. 제품 importer는 V8 문자열 타입과 문자 인코딩까지 검증해야 하며, 조사 도구의 출력을 그대로 설정으로 저장하면 안 된다. [고정 버전 reader 코드](https://github.com/cclgroupltd/ccl_chromium_reader/blob/ef840de30221c4d65bc96d2f4d9057e9ef2f526d/ccl_chromium_reader/ccl_chromium_indexeddb.py)

C1은 `javap -p -c`와 클래스 상수·로컬 변수 정보를 대조했다. 원 다운로드 URL·배포 서명은 이번에 재검증하지 않았다. 현재 공식 릴리스 노트의 5.13 표기와 일치하지만, 동일한 공식 배포 파일임을 해시만으로 입증한 것은 아니다. [RI 릴리스 노트](https://www.cropster.com/product-updates/ri-release-notes/)

## Firescope

### 저장 방식과 범위

F1의 `dist/main.2e097f7be22c8cee.js`에서 다음을 확인했다.

- `localStorageIDBDBName` 기본값은 `ngStorage`, `localStorageIDBStoreName`은 `localStorage`다. IndexedDB `objectStore.put(value, key)`를 사용한다. 서비스 이름의 localStorage와 Chromium의 Local Storage 디렉터리를 혼동하지 않는다.
- `bps.setting`은 그래프 설정이다. `validateSetting`은 옛 `indicatorRorUnit`, `isIndicatorSwitch`를 Indicator 서비스로 옮긴다. 버전별로 같은 항목이 다른 키에 있을 수 있다.
- `setActiveMachine`은 머신 1개를 `roasting-machine.RoastingMachineService`에 저장하고, `unsetActiveMachine`은 그 키를 삭제한다. 로그의 여러 값은 머신 목록이 아니라 이 키의 과거 버전이다. 키 자체가 없는 사용자도 처리해야 한다.
- 전체 머신은 `roasting-machines`, 그래프 템플릿은 `graph-settings/` HTTP 경로에서 가져온다. 이번에는 서버 API를 호출하거나 인증 정보를 사용하지 않았다.

macOS에서 확인한 기본 위치는 `~/Library/Application Support/Firescope/IndexedDB/file__0.indexeddb.leveldb/`다. Windows의 `%APPDATA%\Firescope\IndexedDB\file__0.indexeddb.leveldb\`는 Electron 기본 userData 규칙에 따른 탐색 후보이며, 실제 Windows 설치본으로 검증하지 않았다. userData 변경이나 origin 변경도 고려한다. [Electron app.getPath](https://www.electronjs.org/docs/latest/api/app#appgetpathname)

공식 다운로드 페이지는 1.0.1 파일을 링크하지만 이번 설치본 package는 1.0.2다. 다운로드 파일명으로 런타임 버전이나 DB 스키마를 추정하지 않는다. [Firescope 공식 다운로드](https://eng.firescope.cropster.com/download)

### 실제 추출 결과

| 키 | 복구 레코드 수 | 최고 sequence | 관찰값 |
|---|---:|---:|---|
| `bps.setting` | 12 | 18437 | `dryingEndTemp=150`, `crackStartTemp=200`, `xAxisStart=-14`, `xAxisEnd=720`, `xAxisScaleUnit=60`, `yAxisStart=50`, `yAxisEnd=250` |
| `roasting-machine.RoastingMachineService` | 21 | 19551 | `driver=DummyDriver`, `type=managed`, `protocol=websocket`, BT/ET 테스트 센서 |
| `setting.IndicatorSettingService` | 12 | 18429 | `developmentTimeVisible=true`, `rorInterval=60`, `etBtSwapped=false` |
| `setting.BbpSettingService` | 1 | 229 | `bbpEnabled=false`, `preheatDuration=300` |
| `setting.GlobalSettingService` | 1 | 1269 | `temperature`, `weight`, `language`, `currency` 키 |

`bps.setting`에는 Charge/Drop 감지 플래그와 7/3 온도 차이, BT/ET 색상, Gas/Airflow 이벤트 이름, 보조 센서 축도 있었다. #710의 `xAxisStart=-15`는 설치본 기본값이지만 이번 최고 sequence는 -14다. 기본값·예시·사용자 저장값을 구분한다.

과거 Modbus 레코드 중 최고 sequence 18465는 serial RTU, baudRate 9600, dataBits 8, stopBits 2, parity `none`이었다. BT/ET는 주소 19/20, `sensorId=1`, `read=FC3`, `type=integer`, `decimalPlace=1`이었다. power/airflowPressure는 주소 21/22였다. **이 값을 현재 머신으로 제안하지 않는다.** #710의 `dfa`/FC4 예시는 이번 최고 레코드와 일치하지 않는다.

`setting.ListPageFieldSettingService`도 해독했으나 재고·목록 화면 설정이라 범위에서 제외한다. `setting.RoastingFieldSettingService`는 설치본 코드에서 확인했지만 이번 F2의 설정 키 해독 결과에는 없었다. `roasting.RoastingService`는 세션·로스트 데이터가 섞일 수 있어 import allowlist에 넣지 않는다. Firebase DB는 별도 논리 DB이며 import 대상으로 읽지 않는다.

### LevelDB 파일 import 조건

JSON을 `strings`나 정규식으로 찾는 방식은 조사 단서에만 사용한다. Chromium IDB는 DB/store/index 메타데이터, 자체 comparator, sequence·삭제, WAL, V8/Blink 값을 해석해야 한다. generic LevelDB 라이브러리를 기본 comparator로 열거나 `.log` 파일 하나만 선택해서는 현재 설정을 보장하지 못한다. [Chromium coding scheme](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md), [LevelDB 구현](https://github.com/google/leveldb/blob/main/doc/impl.md)

첫 importer는 소스 앱 종료 후 DB 디렉터리 전체의 일관된 복사본을 사용한다. 실행 중 임의 파일 복사는 DB snapshot과 같지 않다. recovery가 필요한 경우에도 복사본만 연다. 버전에 따라 external blob과 직렬화 wrapper도 필요할 수 있다. [LevelDB snapshot API](https://github.com/google/leveldb/blob/main/doc/index.md), [Chromium value wrapping](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/indexeddb/idb_value_wrapping.cc)

## Cropster RI 5.13

### 문자열 검색보다 강한 정적 근거

C1에서 확인한 클래스·메서드는 다음과 같다.

| 클래스 | 확인한 동작 |
|---|---|
| `com.cropster.roastingintelligence.config.PreferencesConfiguration` | `Preferences.userRoot().node(createSettingsPath(instance))`; `default`는 기본 node로 처리 |
| `com.cropster.roastingintelligence.config.FileSystemConfiguration` | `user.home` 아래 `CropsterRoastingIntelligence/<instance 또는 default>` 생성; Java Preferences `dataDirectory`가 있으면 사용자 지정 경로 사용 |
| `com.cropster.roastingintelligence.service.impl.StorageServiceImpl` | rootDirectory의 `preferences.json`, `machine.json` 읽기·쓰기; `savePreferences` 후 outbox의 같은 이름으로 복사; `cache/cache.json`은 별도 파일 |
| `org.cropster.roastingintelligence.service.impl.JsonWriter` | 일반 preferences에서 `sources`, `channels`, `states` 제외; machine JSON은 `selectedMachineId`, `sources`, `channels`, `states`만 선택; 두 파일에 `version` 추가 |
| `org.cropster.roastingintelligence.PreferencesStore` | 단위·축·RoR·감지 관련 Java Preferences 키 읽기·저장 코드 |

Java Preferences node는 Linux 분석본 기준 `/org/cropster/roastingintelligence`와 instance 하위 경로다. 확인한 설정 키는 `temperatureUnit`, `pressureUnit`, `weightUnit`, `minTemp`, `maxTemp`, `minRiseRate`, `maxRiseRate`, `rorSmoothing`, `ror`, `autoDetectionEnabled`, `autoStartEnabled`다. 인증용 키도 같은 클래스에 존재하므로 node 전체를 export하거나 FC에 복사하지 않는다. C1의 실제 사용자 설정 파일은 확보하지 못했다.

공식 문서도 Windows/macOS/Linux의 홈 폴더 아래 `CropsterRoastingIntelligence/default/cache/cache.json`을 안내한다. 이는 캐시 삭제·지원 자료 안내이고 portable settings export 계약은 아니다. 이번에 검토한 공식 문서에서 머신 설정 export 메뉴나 API 계약은 찾지 못했다. [공식 cache 경로](https://help.cropster.com/en_US/general/how-to-delete-the-roasting-intelligence-ri-app-cache), [지원 폴더 안내](https://help.cropster.com/en_US/general/how-to-find-the-cropsterroastingintelligence-folder-on-your-computer)

### 파일 선택과 우선순위

탐색 후보는 먼저 `<dataDirectory>/preferences.json`, `machine.json`이고, outbox 복사본은 보조 후보다. `dataDirectory` override와 여러 instance를 처리해야 한다. **root JSON과 Java Preferences 중 무엇이 실제 활성 설정으로 우선 적용되는지는 아직 확정하지 않았다.** 파일 시각만으로 결정하지 말고 실제 읽기 순서와 설정 변경 전후 샘플을 검증한다.

`machine.json`의 이름만 보고 완성된 머신 한 대의 표준 설정이라고 가정하지 않는다. `sources`의 connector 타입·직렬화와 `channels`의 역할 연결을 해독하고 `selectedMachineId`를 대조해야 한다. `states`는 의미 확인 전 제외한다. `sent/*.json`, `cache/cache.json` 전체는 기록·계정 등 제외 데이터가 섞일 수 있으므로 기본 import 입력으로 사용하지 않는다.

### Java Preferences는 OS별 별도 탐색

| 플랫폼 | 표준 OpenJDK 저장 방식 | 조사 한계 |
|---|---|---|
| Linux/Unix | 보통 `~/.java/.userPrefs/.../prefs.xml` | `java.util.prefs.userRoot` override와 node 인코딩 고려 |
| Windows | 보통 `HKCU\Software\JavaSoft\Prefs` | registry node/key 인코딩과 해당 RI 배포본 확인 필요 |
| macOS | CFPreferences | Linux의 prefs.xml 경로를 사용하면 안 됨; domain·node 매핑 필요 |

이는 OpenJDK 구현을 근거로 한 후보이며 RI의 bundled JRE, PreferencesFactory, 배포본별 경로 생성까지 보장하지 않는다. RI JSON 폴더가 없다고 Java Preferences도 없다고 판단하지 않는다. 현재 사용자 머신에는 기본 RI JSON 폴더가 없었다. [Unix 구현](https://github.com/openjdk/jdk/blob/master/src/java.prefs/unix/classes/java/util/prefs/FileSystemPreferences.java), [Windows 구현](https://github.com/openjdk/jdk/blob/master/src/java.prefs/windows/classes/java/util/prefs/WindowsPreferences.java), [macOS 구현](https://github.com/openjdk/jdk/blob/master/src/java.prefs/macosx/classes/java/util/prefs/MacOSXPreferences.java)

RI 5.13 릴리스 노트는 기존 로그인 비밀번호 데이터를 설정 파일에서 제거했다고 명시한다. 구버전 자료까지 깨끗하다고 가정하지 않는다. 사용자에게 지원용 `default` 폴더 ZIP 전체를 받아 레포 fixture로 넣는 대신, 필요한 필드만 추출·비식별화한다. [RI 5.13 릴리스 노트](https://www.cropster.com/product-updates/ri-release-notes/)

## Artisan

Artisan은 공식 Help → Save Settings에서 `.aset`를 만든다. 앱의 기본 설정 저장소를 직접 찾아 읽는 경로보다 먼저 이 파일을 지원하는 것이 단순하다. `.alog` 프로파일 import와 독립적으로 진행할 수 있다. [공식 Setup](https://artisan-scope.org/docs/setup/), [설정과 프로파일의 차이](https://github.com/artisan-roaster-scope/artisan/discussions/1158)

공식 `main.py`의 `saveSettings` → `closeEventSettings(filename)`은 `QSettings(filename, IniFormat)`으로 저장한다. 머신 preset도 `.aset`이므로 확장자만으로 전체 사용자 설정인지 판단하지 않는다. QSettings의 escaped string, 배열, `@` 타입 표현을 고려하고 지원할 subset을 실제 export로 검증한다. 단순 JSON 파서나 쉼표·등호 분할로 읽을 수 있는 파일이 아니다. [Artisan 소스](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/main.py), [Qt QSettings](https://doc.qt.io/qt-6/qsettings.html)

같은 파일에 `externalprogram`, `externaloutprogram`, `externaloutprogramFlag`와 장비 action·expression도 포함될 수 있다. FC가 필요한 연결·표시 항목만 allowlist로 가져오고 명령·스크립트·제어 action을 실행하거나 전달하지 않는다. 실제 `.aset` 사용자 샘플과 지원 버전별 schema는 아직 검증하지 않았다. 구현 시에는 움직이는 `master` 대신 검증한 release/commit을 고정한다. 근거: 위 Artisan `settingsLoad`, `closeEventSettings`.

## FC 설정으로 옮길 수 있는 범위

FC 기준 코드는 [RoastSettings](../../src/features/active-roast/model/settings.ts), [곡선 스타일](../../src/features/active-roast/lib/curve-style.ts), [머신 타입](../../src/entities/machine/types.ts), [연결·주소 변환](../../src/entities/machine/lib.ts), [주소 설정](../../src/entities/machine/addressMap.ts), [Modbus adapter](../../src-tauri/sidecar/adapters/modbus.py)다. 아래는 코드 대조에 따른 **구현 제안**이며 실제 import 적용 결과가 아니다.

| 소스 항목 | FC 후보 | 매핑 조건·제약 |
|---|---|---|
| 온도 단위 | `temperatureUnit` | `C/F`, `°C/°F`의 확인된 enum만 정규화; 그래프·머신 단위 우선순위 확인 |
| yAxisStart/End, minTemp/maxTemp | `tempMinC`, `tempMaxC` | 절대 온도를 °C로 변환하고 min < max 검사 |
| 시간축 최대값 | `timeRangeMin` + `timeRangeCustom` 또는 `timeRangePresetMin` | Firescope 초 → 분; FC 정수 1–180분 안에서 지원; custom=false이면 preset이 적용되므로 함께 매핑; 고정 축과 자동 확장 동작 차이 표시 |
| xAxisScaleUnit | `timeTickIntervalSec` | 초 단위 확인; FC preset/custom 설정 함께 처리 |
| BT/ET/RoR 색·굵기 | `curveStyles` | 존재하는 채널만; 색상·숫자 범위 검증 |
| RoR 축 min/max | `rorYMin`, `rorYMax` | 시간 표현과 °C/°F 변화율 변환; 변화율에는 절대 온도 offset을 적용하지 않음 |
| Firescope `rorInterval` | 직접 대응 없음 | F1 차트 코드에서 표시값·축을 `interval / 60`으로 환산; FC 계산 창 `rorSpanSec`에 복사하지 않음 |
| Cropster RoR smoothing·sensitivity | 보류 | FC EMA 강도와 같은 알고리즘·척도라는 근거 없음 |
| `dryingEndTemp` | 직접 대응 없음 | FC `yellowTempC`는 Yellowing 자동 mark; Dry end와 동일 이벤트로 취급하지 않음 |
| `crackStartTemp`, 이벤트 이름·온도 채널 | 미지원 또는 개별 대응 | FC에 동등한 설정이 있는지 항목별 확인; 사용자 이름·ET를 자동 감지 의미로 바꾸지 않음 |
| Charge/Drop 감지 플래그·온도 차이 | 보류 | FC는 standard/sensitive 감지와 시간·노이즈 조건 사용; 7/3을 임의 threshold로 복사하지 않음 |
| serial path, baudRate, dataBits, stopBits, parity | `comport`, `baudrate`, `bytesize`, `stopbits`, `parity` | 프로토콜 enum 변환; OS·USB 포트 변경 시 재선택; parity `none`과 FC `N` 등 실제 값 대조 |
| Modbus address/read/sensorId/decimalPlace | `register`, `func`, `unit_id`, `div` | F1 driver는 address를 그대로 사용하고 sensorId를 setID에 전달; FC3/FC4 → 3/4, decimalPlace 0/1/2 → div 0/1/2 |
| Modbus integer/float/BCD·보정 | 채널 dtype·word order 등 | signed integer, BCD, float scale, nonzero compensation을 생략하면 다른 측정값이 됨; 지원·단위 확인 전 import 불가 표시 |
| power/airflowPressure 보조 센서 | 보류 또는 지원 preset | 라벨만으로 Gas/Airflow 제어 channel이나 write_map을 생성하지 않음 |

F1 `out-tsc/app/driver/drivers/modbus.driver.js`는 `integer`를 signed 16-bit로 읽고 `10 ** decimalPlace`로 나눈다. FC adapter는 `signed`를 지원하지만 기본값은 false이고, 현재 custom form은 signed 항목을 노출하지 않는다. float에서는 FC의 현재 `div` 처리가 정수와 같지 않다. 따라서 주소·baud만 복사해 “머신 연결 import 완료”라고 하면 안 된다. signed·scale·보정과 이후 편집에서의 보존까지 확인해야 한다.

용어·이벤트 매핑은 [CONTEXT.md](../../CONTEXT.md)를 따른다. 표시 순서 `etBtSwapped`를 BT/ET 센서 역할 교환으로 해석하지 않는다. heat feedback 설정을 Heat set 명령으로 옮기지 않는다.

설정 적용은 기존 `roast.settings` 저장 API와 `useMachines.addMachine/updateMachine`을 사용한다. vendor 객체를 FC store에 통째로 spread하지 않고, importer 경계에서 허용 키·타입·단위·범위를 검증한다. 머신 등록은 연결·제어와 별도 단계이며, 기존 설정 덮어쓰기와 실제 연결은 사용자 미리보기에서 선택한다. [설정 API](../../src/features/active-roast/model/settings.ts), [머신 저장소](../../src/entities/machine/model.ts), [현재 form 검증](../../src/widgets/add-machine-modal/model/assembleConnectionParams.ts)

## 권장 구현 순서와 착수 조건

구현 순서는 **Artisan `.aset` → Firescope 복사본 → Cropster 사용자 샘플**을 권장한다. 공식 export를 먼저 지원하고, 확인한 Firescope 저장 형식을 추가하며, Cropster는 schema·활성 설정 우선순위를 확정한 뒤 자동 탐색한다. 이는 구현 난이도와 현재 증거에 따른 제안이다.

공통 흐름은 입력 선택 → 제품/버전 판별 → 허용 설정 추출 → FC 매핑·미지원 사유 미리보기 → 선택 항목 적용이다. fallback도 설정 파일 또는 논리적인 설정 export를 입력으로 한다. 임의 JSON·CSV·`.alog`나 단일 LevelDB `.log`가 설정 import fallback이 되지는 않는다. 읽을 파일이 없으면 기존 머신 form에 확인된 값만 미리 채우고 남은 값은 수동 입력한다.

| 제품 | 구현 전 필요한 최소 검증 |
|---|---|
| Firescope | 지원할 실제 runtime 버전에서 IndexedDB API와 해독값 대조; harmless 그래프 설정 변경·머신 전환·unset 전후 snapshot |
| Cropster | 실제 설정된 root `preferences.json`·`machine.json`·관련 Java Preferences의 비식별 샘플; version/source/channel schema와 읽기 우선순위 |
| Artisan | 전체 설정 export와 머신 preset 각각의 `.aset`; 연결 protocol·배열·Unicode/escaping·지원 dtype |
| 공통 | 지원할 Windows/macOS에서 파일 탐색·포트 재선택·FC 저장 후 재시작 유지; 지원 머신에서 측정값 대조 |

Firescope decoder fixture에는 같은 키 덮어쓰기·삭제, WAL에만 최신 값, compaction, orphan table, 서로 다른 DB/store의 동명 키, Unicode, 잘린 파일, external blob 누락, 앱 실행 중 복사 거부, 미지원 runtime을 포함한다. 예상값은 Chromium의 논리값으로 정한다. raw DB나 사용자 식별·인증 자료는 fixture에 넣지 않고 합성 snapshot을 사용한다. [Chromium 명세](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md), [LevelDB 구현](https://github.com/google/leveldb/blob/main/doc/impl.md)

## 미검증·잔여 위험

Windows/macOS 전체 조합, 실제 Cropster·Artisan 사용자 설정, 브라우저 논리값 대조, FC import round-trip, 실제 로스터 연결·제어는 확인하지 않았다. 가장 큰 위험은 과거·기본값을 현재 설정으로 오인하거나 센서 역할·단위·scale·보정을 바꿔 적용하는 것이다. 확인한 그래프 설정 subset과 검증된 연결 protocol부터 지원 범위를 명시해야 한다.
