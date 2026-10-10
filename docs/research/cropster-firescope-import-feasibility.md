# Cropster·Firescope·Artisan 로스팅 설정 import 가능성

조사일: 2026-10-10 · 관련 이슈: [#710](https://github.com/hhhaan/firstcrack/issues/710)

범위는 머신 연결과 로스팅 그래프·이벤트 설정이다. 프로파일, 히스토리, 재고, 계정·인증 정보는 제외한다. 이번 결과물은 조사 문서이며, FC importer 구현이나 설정 적용은 수행하지 않았다.

**사용자 요구: FC Desktop이 같은 사용자 계정의 로컬 설정 저장소를 자동으로 찾아 읽는다.** 정상 흐름에서 파일 선택이나 경쟁 앱의 수동 export를 요구하지 않는다. Windows Registry·macOS Preferences도 로컬 저장소에 포함한다. 파일 선택·`.aset`는 자동 탐색 실패나 다른 PC에서 가져오는 경우의 fallback이다.

## 판정

| 제품 | 확인한 입력 경로 | 이번에 확인한 것 | 아직 확인하지 못한 것 |
|---|---|---|---|
| Firescope 1.0.2 | 로컬 Chromium IndexedDB `ngStorage` / object store `localStorage` | 설치본 코드와 DB 복사본에서 그래프 설정·머신 캐시 객체 해독 | 브라우저의 현재 논리값과 대조, 버전·OS 호환성, 실제 연결 |
| Cropster RI 5.13 | Java Preferences + 데이터 폴더 루트의 `preferences.json`, `machine.json` | Linux 배포본의 경로 생성·읽기·쓰기·JSON 필터 코드 | 설정된 사용자 파일, 활성 머신·설정 우선순위, Windows/macOS 배포본 |
| Artisan | OS별 QSettings native 저장소; `.aset`는 fallback | 공식 native 저장 코드와 macOS binary plist의 Modbus·통신 설정 직접 읽기 | 해당 로컬 파일의 앱 버전·defaults, Windows/Linux 저장소, FC 변환·연결 |

**세 제품 모두 로컬 자동 탐색·추출 경로가 있다. Firescope·Artisan은 실제 로컬 저장소 읽기까지 확인했고, Cropster는 저장 코드까지 확인했다. FC에 모든 설정을 동일하게 적용할 수 있다는 결론은 아직 아니다.** Artisan도 기본 설정 저장소를 자동으로 읽고 공식 export는 fallback으로 사용한다. [Artisan native 저장 코드](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/main.py), [Cropster 공식 Preferences](https://help.cropster.com/customization-and-preferences/roasting-intelligence-preferences)

## FC의 자동 인식 흐름

1. FC가 현재 사용자 계정의 OS별 알려진 설정 경로·registry node를 탐색한다. 홈 전체를 재귀 검색하거나 경쟁 앱을 실행할 필요는 없다. 앱이 제거되어도 설정이 남을 수 있으므로 실행 파일 존재를 필수 조건으로 삼지 않는다.
2. 발견한 저장소를 읽기 전용으로 확인한다. Firescope는 앱 종료 후 일관된 DB 복사본을 사용하고, Cropster는 instance·dataDirectory override, Artisan은 native 저장소를 처리한다.
3. 제품·확인 가능한 버전과 설정 형식을 판별하고 머신 연결·그래프·이벤트의 허용 항목만 해독한다. 계정·토큰·로스트 데이터는 FC로 반환하지 않는다.
4. FC가 발견한 제품·머신·가져올 설정을 자동으로 미리 채운다. 소스가 여러 개일 때는 제품/설정 후보를 고르게 하며 사용자가 경로를 직접 찾게 하지 않는다.
5. 선택한 설정을 FC에 적용한다. 자동 인식·추출은 장비 자동 연결·제어 실행을 뜻하지 않는다.

FC는 Tauri desktop이므로 로컬 저장소를 읽는 기능을 만들 수 있다. 다만 현재 [desktop capability](../../src-tauri/capabilities/default.json)의 fs scope는 FC의 AppLocalData 중심이고 임의 사용자 설정 경로를 frontend에서 읽는 기능은 구성되어 있지 않다. 구현은 알려진 제품별 경로·node만 읽는 desktop backend 명령으로 시작한다. 범용 파일 읽기 명령이나 홈 전체 fs scope를 frontend에 열 필요는 없다. 이 명령은 소스 상태와 허용 설정만 반환한다. [Tauri 파일 접근 scope](https://v2.tauri.app/plugin/file-system/)

자동 탐색 결과는 `found`, `not-found`, `needs-app-closed`, `unsupported`, `unreadable`을 구분한다. 설정이 없거나 접근 실패한 경우 성공한 import처럼 기본값을 적용하지 않는다. Cropster의 실제 샘플 확보는 개발 중 decoder 검증을 위한 조건이며, 정상 사용 흐름에서 매번 사용자에게 export를 요구하는 조건이 아니다.

## #710에서 수정할 결론

1. **Firescope 값의 이중 JSON 파싱을 고정하지 않는다.** 이번 DB는 IndexedDB/V8 디코딩 후 `dict`로 나왔다. 추가 JSON 파싱은 0회였다. 먼저 Chromium 값을 정상 해독하고, 문자열일 때만 확인된 버전의 직렬화 방식대로 처리한다. 문자열 검색 과정에서 보인 JSON escaping은 실제 저장 타입의 증거가 아니다. 근거: 아래 F1·F2와 [Chromium 직렬화 명세](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md).
2. **로그에 남은 실제 머신이 현재 활성 머신이라는 보장은 없다.** 머신 키에서 21개 레코드를 복구했다. 최고 sequence는 `DummyDriver` 데모 머신이다. 데모 10개·키 삭제 1개를 제외한 설정 10개는 머신 ID 기준 3대의 과거 버전이었다. 이들은 import 후보로 복구할 수 있지만 현재 활성 머신으로 표시하지 않는다. 근거: F1·F2와 아래 과거 머신 복구 결과.
3. **Cropster의 루트 파일부터 조사한다.** RI 5.13은 `<dataDirectory>/preferences.json`, `machine.json`을 저장하고 outbox로 복사한다. outbox만 필수 입력으로 삼거나 `**/*.json` 전체를 가져올 이유가 없다. 근거: C1의 `StorageServiceImpl.savePreferences`.
4. **Roast curve import는 설정 import의 근거가 아니다.** [#56의 Artisan `.alog`](https://github.com/hhhaan/firstcrack/issues/56)와 [#57의 Firescope CSV](https://github.com/hhhaan/firstcrack/issues/57)는 로스팅 기록 이관이고, 이번 조사와 입력 계약이 다르다. Artisan 설정은 `.aset`이다. [Artisan 유지보수자 설명](https://github.com/artisan-roaster-scope/artisan/discussions/1158)

## 로컬 증거와 재현 범위

원본 앱과 DB는 읽기만 했다. Firescope가 실행 중이지 않음을 프로세스 목록으로 확인하고, IndexedDB 폴더를 임시 디렉터리에 복사했다. 설정 키만 결과에 출력했으며, 원본 파일의 SHA-256이 복사 전후·해독 후 동일함을 확인했다. 임시 DB 복사본은 삭제했고 실제 DB·앱 바이너리는 레포에 넣지 않았다. Cropster 앱이나 연결된 로스터는 실행하지 않았다.

사용자 요구 확인 후 Artisan native plist도 Python 표준 `plistlib`로 읽었다. 설정 키 이름·타입만 확인하고 계정·명령·프로파일 값은 출력하지 않았다. 원본 SHA-256이 읽기 전후 동일했다.

| ID | 자료 | 식별 정보 |
|---|---|---|
| F1 | `/Applications/Firescope.app/Contents/Resources/app.asar` | package `desktop`, productName `Firescope`, version `1.0.2`, bundle ID `com.cupnote.firescope`, bundled Electron `32.3.3`; SHA-256 `c842c66bc851cb5a21eee7a06148334760ddee8ff84089d7f89250276ddbdff1` |
| F2 | Firescope `IndexedDB/file__0.indexeddb.leveldb` 복사본 | `CURRENT → MANIFEST-000001`; 활성 table `000062.ldb`, WAL `000060.log`; comparator `idb_cmp1`; 남은 데이터 파일과 활성 파일 목록 일치 |
| C1 | 이전 조사에서 내려받아 둔 Linux RI 5.13 `.deb`와 JAR | `.deb` SHA-256 `8e5ae468c6c1ed3898d3b9728996464916988ed7dda201b942bb797913c73500`; `roastingintelligence-5.13.jar` SHA-256 `9f7a07242b208833e584758aad684193d819d0476d815bcd9a1e021b49b1c1f6` |
| A1 | `~/Library/Preferences/org.artisan-scope.Artisan.plist` | `bplist00` binary plist, 94 keys; `Modbus.input1register`, `Modbus.input1code`, `Modbus.input1deviceId`, `Modbus.input1div`, `Modbus.baudrate`, `Modbus.stopbits`, `Modbus.wordorderLittle`, ExtraComm 통신 설정 확인; 앱 버전 미확인 |

F2 해독에는 조사용 임시 Python 환경에서 [ccl_chromium_reader](https://github.com/cclgroupltd/ccl_chromium_reader/tree/ef840de30221c4d65bc96d2f4d9057e9ef2f526d) 0.3.18을 사용했다. DB 이름 `ngStorage`, origin `file__0@1`, object store `localStorage`를 확인하고, 키별 최고 `ldb_seq_no`를 삭제 레코드까지 포함해 선택한 뒤 `is_live`를 검사했다. 별도로 CURRENT가 지정한 MANIFEST의 table 추가·삭제와 WAL 번호를 확인해 orphan 파일이 없음을 검사했다.

이는 **이 복사본의 최고 sequence를 확인한 결과**다. 네이티브 IndexedDB API가 반환하는 현재 값과 UI 대조까지 수행한 것은 아니다. 이 라이브러리는 오래된·삭제된 레코드도 반환하며, `live_only`만으로 최신 값을 보장하지 않는다. 또한 이번 온도 단위 `°C`는 일부 결과에서 `b'\xb0C'`로 나왔다. 제품 importer는 V8 문자열 타입과 문자 인코딩까지 검증해야 하며, 조사 도구의 출력을 그대로 설정으로 저장하면 안 된다. [고정 버전 reader 코드](https://github.com/cclgroupltd/ccl_chromium_reader/blob/ef840de30221c4d65bc96d2f4d9057e9ef2f526d/ccl_chromium_reader/ccl_chromium_indexeddb.py)

C1은 `javap -p -c`와 클래스 상수·로컬 변수 정보를 대조했다. 원 다운로드 URL·배포 서명은 이번에 재검증하지 않았다. 현재 공식 릴리스 노트의 5.13 표기와 일치하지만, 동일한 공식 배포 파일임을 해시만으로 입증한 것은 아니다. [RI 릴리스 노트](https://www.cropster.com/product-updates/ri-release-notes/)

## Firescope

### 이번 로컬 재확인

**현재 사용자 머신에 Firescope 1.0.2와 설정 DB가 실제로 있으며, 앱을 실행하거나 export하지 않고 설정을 읽었다.** 자동 탐색 입력으로 기본 userData 아래의 IndexedDB 디렉터리를 사용할 수 있다. F1의 `out-tsc/app/main-window.js`는 배포 앱을 `file:` URL로 실행하며, 이번 DB의 origin과 일치한다. Electron 버전은 Framework의 `Info.plist`에서 32.3.3으로 확인했다. 원본 해시가 재확인 전후 동일했고 임시 복사본은 삭제했다.

자동 인식의 대상은 **현재 저장된 그래프 설정과 로컬에서 복구 가능한 머신 설정**이다. 현재 캐시와 과거 설정 후보를 구분하고, 사용자 요청에 따라 `DummyDriver`·확인된 데모 preset은 제외한다. 이번 최고 sequence 머신은 `Test Machine`이며 실제 로스터가 아니다. 과거 머신을 현재 활성 머신으로 자동 선택하지 않고, 복구된 후보 목록에서 가져올 머신을 고르게 한다. 로컬에 없는 머신 목록을 얻기 위해 서버 로그인을 요구하는 흐름은 이 import의 범위에서 제외한다.

### macOS 우선 지원과 Intel Mac

첫 지원 대상은 macOS이며 **Intel Mac과 Apple Silicon을 포함한다.** Electron의 기본 userData 위치는 macOS 사용자 계정·앱 이름으로 정해지며 CPU별 경로는 아니다. 따라서 같은 지원 Firescope 버전·스키마라면 Intel/Apple Silicon에 공통 탐색·해독 로직을 사용할 수 있다고 판단한다. 사용자 이름을 하드코딩하지 않고 OS 홈 경로 API로 찾는다. [Electron userData 규칙](https://www.electronjs.org/docs/latest/api/app#appgetpathname)

FC의 기존 [릴리스 matrix](../../.github/workflows/release.yml)는 `aarch64-apple-darwin`과 `x86_64-apple-darwin`을 별도 빌드한다. [sidecar 빌드](../../scripts/build-sidecar.sh)도 두 아키텍처의 바이너리 이름을 구분한다. importer의 바이너리 의존성이 추가되면 각각의 패키지에 포함하고 실행 검증해야 한다. 현재 릴리스 구성은 Intel importer의 실행 성공 증거가 아니다.

이번 실제 해독 환경은 **arm64 / macOS 26.6.2**이며 Intel Mac에서 실행하지 않았다. 저장소 읽기는 서버 인증·네트워크 접속 없이 수행했다. 첫 지원 검증은 Firescope 1.0.2 / Electron 32.3.3을 기준으로 Intel·ARM의 FC 패키지에서 동일한 합성 snapshot을 해독하고, Intel 사용자 저장소도 읽어 대조한다.

**동일한 macOS라는 조건만으로 모든 Mac의 성공을 보장하지 않는다.** 지원 FC/macOS 버전, Firescope/runtime 스키마, 같은 사용자 계정의 읽을 수 있는 로컬 저장소, 종료된 앱의 일관된 복사본이 필요하다. 이번 Firescope `Info.plist`는 최소 macOS 10.15를 선언하지만 FC와 decoder 의존성의 실질 최소 지원 버전까지 입증하지는 않는다. FC 설정에는 `minimumSystemVersion`이 별도 지정돼 있지 않으며 실제 배포 패키지·의존성과 함께 확인해야 한다. [FC bundle 설정](../../src-tauri/tauri.conf.json), [Tauri minimumSystemVersion](https://v2.tauri.app/reference/config/#minimumsystemversion)

### 저장 방식과 범위

F1의 `dist/main.2e097f7be22c8cee.js`에서 다음을 확인했다.

- `localStorageIDBDBName` 기본값은 `ngStorage`, `localStorageIDBStoreName`은 `localStorage`다. IndexedDB `objectStore.put(value, key)`를 사용한다. 서비스 이름의 localStorage와 Chromium의 Local Storage 디렉터리를 혼동하지 않는다.
- `bps.setting`은 그래프 설정이다. `validateSetting`은 옛 `indicatorRorUnit`, `isIndicatorSwitch`를 Indicator 서비스로 옮긴다. 버전별로 같은 항목이 다른 키에 있을 수 있다.
- `setActiveMachine`은 머신 1개를 `roasting-machine.RoastingMachineService`에 저장하고, `unsetActiveMachine`은 그 키를 삭제한다. 로그의 여러 값은 머신 목록이 아니라 이 키의 과거 버전이다. 키 자체가 없는 사용자도 처리해야 한다.
- `validateRoastingMachine`은 `network = connection[connection.type]`, `sensors = connection[connection.protocol]`로 활성 연결·센서 설정을 선택한다. serial/ethernet 하위 객체의 존재 여부만으로 연결 방식을 판단하지 않는다.
- 전체 머신은 `roasting-machines`, 그래프 템플릿은 `graph-settings/` HTTP 경로에서 가져온다. 이번에는 서버 API를 호출하거나 인증 정보를 사용하지 않았다.

macOS에서 확인한 기본 위치는 `~/Library/Application Support/Firescope/IndexedDB/file__0.indexeddb.leveldb/`다. Windows의 `%APPDATA%\Firescope\IndexedDB\file__0.indexeddb.leveldb\`는 Electron 기본 userData 규칙에 따른 탐색 후보이며, 실제 Windows 설치본으로 검증하지 않았다. userData 변경이나 origin 변경도 고려한다. [Electron app.getPath](https://www.electronjs.org/docs/latest/api/app#appgetpathname)

공식 다운로드 페이지는 1.0.1 파일을 링크하지만 이번 설치본 package는 1.0.2다. 다운로드 파일명으로 런타임 버전이나 DB 스키마를 추정하지 않는다. [Firescope 공식 다운로드](https://eng.firescope.cropster.com/download)

### 실제 추출 결과

| 키 | 복구 레코드 수 | 최고 sequence | 관찰값 |
|---|---:|---:|---|
| `bps.setting` | 12 | 18437 | `dryingEndTemp=150`, `crackStartTemp=200`, `xAxisStart=-14`, `xAxisEnd=720`, `xAxisScaleUnit=60`, `yAxisStart=50`, `yAxisEnd=250` |
| `roasting-machine.RoastingMachineService` | 21 | 19551 | `name=Test Machine`, `preset=test`, `driver=DummyDriver`, `type=managed`, `protocol=websocket`, BT/ET 테스트 센서 |
| `setting.IndicatorSettingService` | 12 | 18429 | `developmentTimeVisible=true`, `rorInterval=60`, `etBtSwapped=false` |
| `setting.BbpSettingService` | 1 | 229 | `bbpEnabled=false`, `preheatDuration=300` |
| `setting.GlobalSettingService` | 1 | 1269 | `temperature`, `weight`, `language`, `currency` 키 |

`bps.setting`에는 Charge/Drop 감지 플래그와 7/3 온도 차이, BT/ET 색상, Gas/Airflow 이벤트 이름, 보조 센서 축도 있었다. #710의 `xAxisStart=-15`는 설치본 기본값이지만 이번 최고 sequence는 -14다. 기본값·예시·사용자 저장값을 구분한다.

과거 머신별로 확인한 연결 설정은 다음과 같다. 실제 포트 식별자·네트워크 주소는 문서에 기록하지 않았다.

| 과거 머신 이름 | 해당 머신의 최고 sequence | preset | 활성 연결 | 센서 설정 |
|---|---:|---|---|---|
| `dfa` | 15167 | `easyster-non-option` | serial RTU, 9600 baud, 8 data bits, 2 stop bits, parity `none` | 둘 다 주소 1000, sensorId 1, FC4, integer, decimalPlace 1 |
| `ㅇㄹ` | 17391 | `giesen-wxa` | Ethernet TCP / `S7Driver` | BT/ET, power, airflowPressure, drumSpeed 및 설정값 채널 |
| `d` | 18465 | `buja-smart-gas-control` | Ethernet TCP | 주소 19/20, sensorId 1, FC3, integer, decimalPlace 1; power/airflowPressure는 21/22 |

**18465를 serial RTU로 적었던 이전 문서를 수정한다.** 이 레코드는 `connection.type=ethernet`인데 과거 serial 객체도 남아 있었다. 활성 Ethernet 설정을 선택해야 한다. #710의 `dfa`/FC4 설정은 실제 과거 레코드에 있었지만 현재 최고 sequence 머신과는 다르다. 위 세 머신은 과거 설정 복구 후보이며 현재 머신으로 표시하지 않는다.

이번 그래프 값의 직접 매핑 후보는 FC `tempMinC=50`, `tempMaxC=250`, `timeRangeMin=12`와 `timeRangeCustom=true`, 시간 눈금 60초, BT/ET/RoR의 색상이다. 색상은 해당 채널의 `color`만 변경하고 기존 선 굵기·스타일은 보존한다. Firescope의 음수 시간축 시작과 자동 축 확장은 그대로 재현되지 않으므로 미리보기에 차이를 표시한다. FC 저장·재시작 검증은 아직 수행하지 않았다.

`setting.ListPageFieldSettingService`도 해독했으나 재고·목록 화면 설정이라 범위에서 제외한다. `setting.RoastingFieldSettingService`는 설치본 코드에서 확인했지만 이번 F2의 설정 키 해독 결과에는 없었다. `roasting.RoastingService`는 세션·로스트 데이터가 섞일 수 있어 import allowlist에 넣지 않는다. Firebase DB는 별도 논리 DB이며 import 대상으로 읽지 않는다.

### 테스트 머신을 제외한 과거 머신 복구

**이번 로컬 자료에서는 3대의 서로 다른 머신 설정을 추출할 수 있다.** 동일 머신의 설정 변경·재선택을 별도 머신으로 세지 않도록 저장된 `id`로 묶고, 각 ID의 가장 큰 sequence를 선택했다. `dfa`는 2개, `ㅇㄹ`은 4개, `d`는 4개 버전이었으며 모두 `000060.log`에 남아 있었다. 데모 판별은 `DummyDriver`·확인된 `test` preset을 사용하며 이름에 “test”가 포함됐다는 이유만으로 실제 머신을 제외하지 않는다. ID가 없으면 이름만으로 합치지 않고 별도 검증 후보로 둔다. 근거: F2 재해독.

이는 **과거 선택·저장된 머신 설정**의 복구다. F1의 `setActiveMachine`은 캐시를 저장하고 `connectActiveMachine`은 별도 메서드다. 따라서 캐시 존재만으로 실제 장비 연결 성공이나 연결 일시를 입증하지 못한다. `unsetActiveMachine`은 로그아웃에서도 호출되고, 서버의 머신 삭제는 별도 HTTP 요청이다. 키 삭제 1개를 특정 머신의 삭제 기록으로 해석할 수 없다.

복구 목록에는 “과거 설정” 출처를 표시하고 각 머신의 연결·센서 항목을 FC 매핑 후 미리 보여준다. 기존 머신을 덮어쓰거나 자동 연결하지 않는다. 전체 그래프 설정은 별도 키의 현재 값을 가져오며, 각 과거 머신에 당시 그래프 설정이 연결돼 있다고 가정하지 않는다.

**사용했던 모든 머신을 로컬만으로 보장할 수는 없다.** LevelDB compaction은 덮어쓴 과거 값을 제거하고 오래된 로그를 삭제한다. 이번 3대는 현재 남아 있는 값이어서 읽을 수 있으며, DB 정리·재설치·앱 사용 이후에도 같은 이력이 남는다는 계약은 없다. 그러므로 제품 흐름은 “복구 가능한 머신 자동 검색”으로 설명하고 전체 머신 목록과 구분한다. [LevelDB compaction·로그 정리](https://github.com/google/leveldb/blob/main/doc/impl.md)

### 전체 연결 방식 조사 — Modbus 이외와 ASCII

**F1의 연결 factory에는 실제 장비 드라이버 8종과 `DummyDriver`가 있다.** `out-tsc/app/ipc-handlers.js`의 connect/read/write가 `driver.manager.js`를 호출하고, factory의 모든 분기와 각 드라이버 구현을 대조했다. 아래 “FC 구현 있음”은 활성 adapter 실행 경로가 있다는 뜻이며, Firescope 설정 import 완료나 실제 장비 호환 검증을 뜻하지 않는다. 다른 Firescope 버전과 서버의 전체 preset 목록은 이번 inventory로 보장하지 않는다.

| Firescope 드라이버 / 연결 방식 | 소스에서 확인한 통신 | FC 대응과 import 조건 |
|---|---|---|
| `ModbusDriver` / serial RTU | `connectRTUBuffered`; serial path·baud·data bits·parity·stop bits | `modbus`, `mode=rtu` 구현 있음; signed·scale·센서 주소 매핑 필요 |
| `ModbusDriver` / serial ASCII | `connectAsciiSerial`; **Modbus ASCII** | `modbus`, `mode=ascii` 구현 있음; RTU로 대체하지 않고 ASCII enum 유지 |
| `ModbusDriver` / Ethernet TCP | `connectTCP`; IP·port | `modbus`, `mode=tcp` 구현 있음; unit ID·FC3/4·register·decode까지 매핑 |
| `ModbusDriver` / Ethernet UDP | `connectUDP`; IP·port | `modbus`, `mode=udp` 구현 있음; 실제 장비의 framing·응답 대조는 미검증 |
| `S7Driver` | nodes7 TCP 연결, rack=0·slot; DB INT/REAL | `s7` 구현 있음; DB 번호·byte offset·slot·scale 보존, 단위/보정 제약 적용 |
| `PhidgetDriver` | Phidget SDK; 1046·1048·TMP1100·TMP1200 센서별 구현 | `phidget` 온도 adapter는 있으나 동등 설정은 일부만 대응; 아래 hub/RTD/전압 변환 차이 확인 |
| `EasysterSmartDriver` | Modbus 상속; 읽기는 일반 Modbus, 화력·드럼·댐퍼 쓰기는 전용 주소 | 온도 읽기는 `modbus` 후보; source transport·센서 decode 검증 후 적용. FC의 현재 Modbus 제어 쓰기는 미지원 |
| `ProbatPlcDriver` | Modbus 상속 + 연결/종료 handshake 및 읽기 중 watchdog 쓰기 | **일반 `modbus`로 치환하면 전용 동작이 빠짐**; 해당 동작 검증·구현 전 연결 설정 적용 미지원 |
| `DiedrichIrDriver` | Phidget 상속 + VoltageRatioInput으로 화력·댐퍼 읽기/변환 | BT/ET도 센서 설정별 검증 필요; 추가 아날로그 값·변환은 현재 FC Phidget adapter에 없음 |
| `WebsocketDriver` | 내부 client는 Probat P3 전용; `ws://IP:port/WebSocket` | `probat_ws`는 있으나 **요청 명령·Origin·keepalive가 다름**; 기존 adapter와의 동등성 미확정 |
| `BulletR1Driver` | USB 장치를 VID/PID로 선택하고 전용 endpoint 명령·바이너리 응답 처리 | **활성 Bullet adapter 없음**; USB 전용 구현·Intel/ARM 패키징·실장비 검증 필요 |
| `DummyDriver` | 데모 데이터 | 사용자 요구대로 import 후보에서 제외 |

FC의 활성 factory는 `virtual`, `kaleido`, `s7`, `modbus`, `probat_ws`, `phidget`다. dependency나 `extern` 참고 파일만 있다는 이유로 Bullet·범용 serial 연결을 지원한다고 표시하지 않는다. 근거: F1 `driver.manager.js`, `drivers/*.driver.js`와 [FC factory](../../src-tauri/sidecar/adapters/__init__.py), [Modbus](../../src-tauri/sidecar/adapters/modbus.py), [S7](../../src-tauri/sidecar/adapters/s7.py), [Phidget](../../src-tauri/sidecar/adapters/phidget.py), [Probat WS](../../src-tauri/sidecar/adapters/probat_ws.py).

**ASCII는 문자 표현 이름만으로 프로토콜을 결정할 수 없다.** 이번 Firescope의 ASCII는 주소·function·data를 문자로 표현하는 Modbus ASCII다. 임의의 온도 문자열·CSV 한 줄·기기 전용 query/response 시리얼을 의미하지 않는다. 범용 ASCII/text serial adapter는 이번 Firescope factory와 FC factory에 없다. FC의 Kaleido Serial은 전용 줄 단위 메시지 경로이며 일반 Modbus ASCII의 대체가 아니다. [Modbus 공식 ASCII/RTU 설명](https://www.modbus.org/introduction-to-modbus), [FC Kaleido](../../src-tauri/sidecar/adapters/kaleido.py), [활성 serial 처리](../../src-tauri/sidecar/extern/kaleido.py)

전용 드라이버에서 확인한 중요한 차이는 다음과 같다.

- **Probat PLC:** connect에서 register 12288에 mask write를 하고, read에서 register 12390을 읽어 12289에 watchdog 값을 쓴 뒤 일반 센서를 읽는다. disconnect에도 mask write가 있다. 따라서 “온도 읽기만”이어도 PLC 쓰기가 포함되는 연결 규약이다. 주소만 `custom_modbus`로 옮기지 않으며, 설정 읽기/import 중에는 이 동작을 실행하지 않는다. 근거: F1 `probat-plc.driver.js`.
- **Probat WebSocket:** Firescope는 `getCurrentRoastingStep`, Origin `http://127.0.0.1`, 25초마다 application `keepAlive`를 사용한다. FC는 `getData`, hostname 기반 Origin, WebSocket ping을 사용한다. Firescope ET는 `exhaustAirTemp`이며 FC도 source 의미에 맞춰 `channel_nodes.ET`를 명시해야 한다. 같은 URL과 JSON이라는 이유로 동일 프로토콜이라고 확정하지 않는다. 근거: F1 `websocket/probat.client.js`, `websocket.driver.js`와 위 FC Probat WS 코드.
- **Phidget/Diedrich:** Firescope는 hubId·thermocoupleType·rtdType·rtdWire를 적용하고, 1046은 VoltageRatioInput을 RTD 온도로 변환한다. Diedrich는 추가 voltage-ratio 채널로 화력·댐퍼를 계산한다. FC는 현재 TemperatureSensor의 BT/ET channel과 optional device serial만 설정한다. source sensorId → channel 외 필수 설정을 버리면 동작이 달라지므로 그대로 지원 처리하지 않는다. 공식 가이드도 Phidget와 Diedrich를 함께 안내하지만, Network Server 설정 안내만으로 현재 설치본의 센서 구현을 대체해 판단하지 않는다. 근거: F1 `phidget.sensor.js`, `diedrich-ir.driver.js`와 [Firescope 공식 Phidget/Diedrich 가이드](https://docs.firescope.io/roasting-machine/phidget).
- **Bullet:** 이 버전은 VID `0x0483`, PID `0x5741` 또는 `0xa27e`, interface 1, IN `0x81`/OUT `0x03` endpoint를 코드에 고정한다. Modbus register·serial port를 가져오는 방식이 아니다. 로컬 머신 설정이 남아 있으면 driver를 식별할 수 있지만 전용 명령·packet decode는 FC adapter가 구현해야 한다. 근거: F1 `bullet-r1.driver.js`.

**모든 연결 주소가 사용자 DB의 register 목록으로 저장되는 것은 아니다.** Modbus는 register/unit ID, S7은 DB/offset, Phidget는 channel/hub/센서 타입, WebSocket은 IP/port와 전용 node 의미를 가져와야 한다. Probat handshake와 Bullet USB 규약처럼 드라이버에 고정된 값도 있다. DB에 저장된 통신·센서 설정의 추출과 해당 드라이버의 동작 재현을 별도 판정한다. 공식 연결 가이드도 serial port, Ethernet 설정, Phidget 설치로 절차가 나뉜다. [serial 가이드](https://docs.firescope.io/roasting-machine/autonics), [Probat Type3 가이드](https://docs.firescope.io/roasting-machine/probat-probatone-type3)

매핑 순서는 **`connection.driver` → 선택된 `connection.type`/하위 subtype → 센서 schema**다. Firescope 자체도 driver를 protocol보다 먼저 선택한다. 알려진 전용 driver를 무시하고 `protocol=modbus/phidget/websocket`만 보고 일반 adapter로 내리지 않는다. driver가 없을 때만 검증된 버전의 protocol fallback을 사용하며, 알 수 없는 driver/mode는 `unsupported`로 남긴다. Firescope의 unknown → Dummy fallback을 FC import에서 재현하지 않는다. FC Modbus도 알 수 없는 mode가 RTU로 내려갈 수 있으므로 import 경계에서 enum을 제한한다. stopBits 1.5는 FC 생성자에서 int로 축소되므로 수정·검증 전 동일 동작 지원으로 표시하지 않는다.

이번 실제 DB의 실머신 3대는 일반 Modbus RTU/TCP와 S7였다. ASCII·UDP·Phidget·Probat·Bullet의 설정된 사용자 샘플이나 실제 장비는 확인하지 않았다. 후속 검증은 각 driver의 합성 설정 변환·저장·재편집 후 값 보존, 지원 transport의 실제 측정값, 전용 handshake/message/decode를 확인하는 순서다. Intel·ARM 양쪽에서 serial/USB/Phidget 의존성까지 확인한다.

### LevelDB 파일 import 조건

JSON을 `strings`나 정규식으로 찾는 방식은 조사 단서에만 사용한다. Chromium IDB는 DB/store/index 메타데이터, 자체 comparator, sequence·삭제, WAL, V8/Blink 값을 해석해야 한다. generic LevelDB 라이브러리를 기본 comparator로 열거나 `.log` 파일 하나만 선택해서는 현재 설정을 보장하지 못한다. [Chromium coding scheme](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md), [LevelDB 구현](https://github.com/google/leveldb/blob/main/doc/impl.md)

첫 importer는 소스 앱 종료 후 DB 디렉터리 전체의 일관된 복사본을 사용한다. 실행 중 임의 파일 복사는 DB snapshot과 같지 않다. recovery가 필요한 경우에도 복사본만 연다. 버전에 따라 external blob과 직렬화 wrapper도 필요할 수 있다. [LevelDB snapshot API](https://github.com/google/leveldb/blob/main/doc/index.md), [Chromium value wrapping](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/indexeddb/idb_value_wrapping.cc)

### FC에서 사용할 decoder

기존 Python sidecar를 해독 기능의 실행 위치로 활용할 수 있다. 다만 조사용 ccl reader를 그대로 추가하는 것만으로 제품 importer가 완성되지는 않는다. 고정 버전의 `RawLevelDb`는 CURRENT가 아니라 가장 큰 MANIFEST 파일명을 선택하고 모든 데이터 파일을 스캔하며, CRC를 검증하지 않는다. IndexedDB metadata의 삭제와 최신 값도 별도로 재구성해야 한다. 최신 설정 해독이 실패하면 과거 설정으로 대체하지 않고 읽기 실패를 반환한다. [LevelDB reader 코드](https://github.com/cclgroupltd/ccl_chromium_reader/blob/ef840de30221c4d65bc96d2f4d9057e9ef2f526d/ccl_chromium_reader/storage_formats/ccl_leveldb.py), [IndexedDB reader 코드](https://github.com/cclgroupltd/ccl_chromium_reader/blob/ef840de30221c4d65bc96d2f4d9057e9ef2f526d/ccl_chromium_reader/ccl_chromium_indexeddb.py)

ccl의 일반 package import에는 Brotli/zstd가 포함되고 Snappy 의존성은 Git HEAD를 참조하므로 별도 버전 고정·패키징 검증이 필요하다. native LevelDB를 사용하더라도 Chromium comparator와 Blink/V8 값 해독은 추가로 필요하다. **현재 샘플 추출은 검증됐지만, 출시 가능한 decoder 선택·구현은 미완료다.** 기존 sidecar에서 허용 설정만 읽는 기능을 만들고 합성 DB의 논리값과 대조하는 방향을 우선 검토한다. [ccl package metadata](https://github.com/cclgroupltd/ccl_chromium_reader/blob/ef840de30221c4d65bc96d2f4d9057e9ef2f526d/pyproject.toml), [Chromium coding scheme](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md)

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

### native 설정 자동 탐색

공식 `main.py`는 app `Artisan`, organization `artisan-scope`, domain `artisan-scope.org`를 지정하고 기본 `QSettings()`로 현재 설정을 읽고 저장한다. 이 이름과 Qt NativeFormat 규칙에 따른 기본 탐색 위치는 다음과 같다. macOS 파일은 이번 사용자 머신에서도 직접 읽었다. Windows/Linux 위치는 소스·문서 기준이며 실설치 검증은 하지 않았다. [Artisan main.py](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/main.py), [이름 상수](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/util.py), [Qt native 저장 위치](https://doc.qt.io/qt-6/qsettings.html#platform-specific-notes)

| 플랫폼 | 현재 Artisan의 기본 사용자 저장소 |
|---|---|
| macOS | `~/Library/Preferences/org.artisan-scope.Artisan.plist` / CFPreferences domain `org.artisan-scope.Artisan` |
| Windows | `HKCU\Software\artisan-scope\Artisan` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/artisan-scope/Artisan.conf` |

QSettings는 organization/system fallback과 경로 override도 지원하므로 앱의 논리 설정과 대조한다. `ArtisanViewer`는 별도 설정 저장소이며 로스터 연결 import의 기본 입력에서 제외한다. 구버전은 organization/domain이 달랐으므로 지원 버전 확정 후 해당 legacy 위치만 추가한다. Windows는 일반 JSON 파일이 아니라 Registry를 읽는 OS별 adapter가 필요하다. 근거: 위 소스·Qt 문서.

native 저장은 기본값과 다른 항목만 기록할 수 있다. `closeEventSettings()`가 `self.defaultSettings`와 함께 저장하기 때문이다. 따라서 키가 없다고 센서·기능이 없다고 단정하지 않고 지원 버전의 defaults와 대조한다. A1의 94개 키는 전체 설정 export가 아니다. 실제 파일 발견·해독과 모든 설정 복원은 별도 검증 단계다. 근거: `main.py`의 `closeEventSettings`, `saveAllSettings`, startup `settingsLoad`.

### 파일 fallback

Artisan은 공식 Help → Save Settings에서 `.aset`를 만든다. 자동 native 탐색이 실패하거나 다른 PC에서 가져오는 경우 이 파일을 fallback 입력으로 받는다. `.alog` 프로파일 import와 독립적으로 진행할 수 있다. [공식 Setup](https://artisan-scope.org/docs/setup/), [설정과 프로파일의 차이](https://github.com/artisan-roaster-scope/artisan/discussions/1158)

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
| Firescope `connection.driver`, `connection.type`, `connection.protocol` | 전용 driver·transport·protocol 선택 | driver를 먼저 판정; `connection[type]`와 `connection[protocol]`만 사용; 일반 Modbus에서 subtype RTU/ASCII/TCP/UDP → 동일 FC mode; 남은 다른 연결 객체 무시 |
| serial path, baudRate, dataBits, stopBits, parity | `comport`, `baudrate`, `bytesize`, `stopbits`, `parity` | 프로토콜 enum 변환; OS·USB 포트 변경 시 재선택; parity `none`과 FC `N` 등 실제 값 대조 |
| Modbus address/read/sensorId/decimalPlace | `register`, `func`, `unit_id`, `div` | F1 driver는 address를 그대로 사용하고 sensorId를 setID에 전달; FC3/FC4 → 3/4, decimalPlace 0/1/2 → div 0/1/2 |
| Modbus integer/float/BCD·보정 | 채널 dtype·word order 등 | signed integer, BCD, float scale, nonzero compensation을 생략하면 다른 측정값이 됨; 지원·단위 확인 전 import 불가 표시 |
| S7 sensor `address`, `start`, `type` | `channels[].db`, `offset`, `type` | F1은 `DB${address},INT/REAL${start}`로 읽음; address는 DB 번호, start는 byte offset; integer → 0, float → 1, area=6 |
| S7 `connection.slot` | `slot` | F1 기본 slot은 1, FC custom 기본은 0; source 값 또는 확인한 F1 기본 1을 명시하며 rack=0 |
| power/airflowPressure 보조 센서 | 보류 또는 지원 preset | 라벨만으로 Gas/Airflow 제어 channel이나 write_map을 생성하지 않음 |

F1 `out-tsc/app/driver/drivers/modbus.driver.js`는 `integer`를 signed 16-bit로 읽고 `10 ** decimalPlace`로 나눈다. FC adapter는 `signed`를 지원하지만 기본값은 false이고, 현재 custom form은 signed 항목을 노출하지 않는다. float에서는 FC의 현재 `div` 처리가 정수와 같지 않다. 따라서 주소·baud만 복사해 “머신 연결 import 완료”라고 하면 안 된다. signed·scale·보정과 이후 편집에서의 보존까지 확인해야 한다.

F1의 보정은 센서 단위에서 머신 온도 단위로 변환한 후 compensation을 더하는 방식이다. FC Modbus에는 현재 이 보정 처리가 없고, FC S7에는 온도 단위 변환·보정이 없다. 보정 숫자를 connectionParams에 저장하는 것만으로 동작이 같아지지 않는다. S7 driver는 rack=0을 사용하고 BaseDriver는 `slot ?? 1`을 사용한다. 근거: F1 `s7.driver.js`, `base.driver.js`, frontend sensor reading 처리와 [FC S7 adapter](../../src-tauri/sidecar/adapters/s7.py).

용어·이벤트 매핑은 [CONTEXT.md](../../CONTEXT.md)를 따른다. 표시 순서 `etBtSwapped`를 BT/ET 센서 역할 교환으로 해석하지 않는다. heat feedback 설정을 Heat set 명령으로 옮기지 않는다.

설정 적용은 기존 `roast.settings` 저장 API와 `useMachines.addMachine/updateMachine`을 사용한다. vendor 객체를 FC store에 통째로 spread하지 않고, importer 경계에서 허용 키·타입·단위·범위를 검증한다. 머신 등록은 연결·제어와 별도 단계이며, 기존 설정 덮어쓰기와 실제 연결은 사용자 미리보기에서 선택한다. [설정 API](../../src/features/active-roast/model/settings.ts), [머신 저장소](../../src/entities/machine/model.ts), [현재 form 검증](../../src/widgets/add-machine-modal/model/assembleConnectionParams.ts)

## Firescope 매핑 구현 계획

**변수명·타입·단위·센서 역할을 변환해 같은 주소에서 같은 측정값을 얻도록 한다.** 파일 해독, 머신/그래프 변환, 미리보기·적용을 구분한다. 자동 변환이 가능한 항목은 미리 채우고, 의미가 다르거나 FC가 지원하지 않는 항목은 원본값과 이유를 보여준다. 사용자에게 모든 필드의 매핑을 처음부터 다시 입력하게 하지 않는다.

1. **소스 추출:** macOS의 알려진 Firescope 경로를 native backend에서 찾고 종료된 앱의 DB 폴더 복사본을 Python sidecar에서 해독한다. 허용 설정 DTO에 머신 ID·sequence·현재/과거 출처를 붙인다. 데모를 제외하고 머신 ID별 마지막 설정을 고르며 그래프는 별도 키의 현재 값을 사용한다. CRC·CURRENT·삭제·V8 문자열 검증은 앞의 decoder 조건을 충족해야 한다.
2. **명시적 변환:** driver → 선택된 transport/subtype → 센서 schema 순으로 판정하고 소스 경로 → FC 경로 → 타입·enum·단위 변환 규칙을 고정한다. 각 항목에 원본값·변환값과 `mapped`, `needs-review`, `unsupported`를 제공한다. `missing`·`null`·0·false를 구분하고 주소에 임의 ±1/40001 보정을 하지 않는다. 필수 센서의 타입·보정이나 전용 연결 규약을 재현할 수 없으면 해당 머신 적용을 차단한다.
3. **FC가 읽을 설정 구성:** 초기 머신은 `custom_modbus` 또는 `custom_s7`로 등록하고 소스의 주소·통신 옵션을 명시한다. preset 문자열 유사성으로 FC registry의 기본 주소를 선택하지 않는다. 읽기 센서 주소로 쓰기 `write_map`, PID 또는 제어 capabilities를 만들지 않는다. known preset은 빈 write_map도 기본 쓰기 설정을 상속할 수 있으므로 custom key를 사용하는 것이 필요하다. [FC merge](../../src-tauri/sidecar/manager.py), [custom registry](../../src/entities/machine/roasterRegistry.ts)
4. **자동 미리보기:** 복구한 머신 목록과 연결·센서·그래프의 변환 결과를 표시하고 가져올 항목을 선택하게 한다. 모든 저장된 주소는 지원 여부와 함께 확인 가능하게 보존한다. `%`, `Pa`, `Hz`, `*Setting` 센서가 있다는 이유만으로 FC의 Gas/Airflow/Drum 제어 주소로 적용하지 않는다. 미지원 주소는 추출 성공과 적용 미지원으로 구분하며, 조용히 누락한 뒤 전체 적용 성공으로 표시하지 않는다.
5. **저장과 검증:** 선택한 설정만 기존 저장 API에 적용하고 저장 완료·재시작 유지까지 확인한다. 기존 머신은 기본적으로 덮어쓰지 않는다. source 머신 ID를 최소 import metadata로 보존해 재import의 중복 후보를 식별한다. 자동 연결은 수행하지 않으며 별도 연결 테스트에서 기존 `/connect`를 사용한다.

첫 지원 범위는 실제 로컬 샘플과 맞는 **일반 Modbus RTU/TCP의 FC3/4 signed16, S7 DB INT/REAL, decimalPlace 0/1/2, 보정 0**부터다. S7 온도는 °C를 우선 지원한다. Modbus ASCII/UDP는 기존 FC adapter를 활용하되 source 설정·측정값 대조 후 지원 범위에 추가한다. Modbus float scaling·센서별 혼합 word order, BCD, nonzero compensation, 다른 단위·타입과 Phidget/Probat/Bullet 전용 동작은 미지원 이유를 표시하고 검증 후 확장한다. 이 범위는 전체 주소의 추출 가능성과 별개이며, 모든 소스 설정의 동일 동작을 이미 지원한다는 뜻이 아니다.

### 확인한 값의 변환 예

| Firescope 원본 | FC가 사용할 설정 |
|---|---|
| `dfa`: serial RTU, baudRate 9600, dataBits 8, stopBits 2, parity none | `mode=rtu`, `baudrate=9600`, `bytesize=8`, `stopbits=2`, `parity=N`; serial.path → comport |
| `dfa` BT: address 1000, read FC4, sensorId 1, integer, decimalPlace 1 | `modbus_registers.BT={register:1000,func:4,unit_id:1,float:false,signed:true,div:1,mode:C}`; ET도 같은 규칙 |
| `ㅇㄹ` BT: address 2, start 38, integer, decimalPlace 0 | `channels[]`의 `{role:BT,db:2,offset:38,area:6,type:0,div:0}`; ET는 offset 36 |
| `ㅇㄹ` slot 1 | `rack=0`, `slot=1`; FC 기본 slot 0으로 대체하지 않음 |
| yAxis 50–250, xAxisEnd 720, tick 60 | `tempMinC=50`, `tempMaxC=250`, `timeRangeMin=12`, `timeRangeCustom=true`, `timeTickPresetSec=60`, `timeTickCustom=false` |
| btLineColor / etLineColor | `curveStyles.bt.color` / `curveStyles.et.color`; 기존 채널의 다른 style 필드는 유지 |

위 예시는 구현할 변환 계약이며 현재 FC에 적용한 결과가 아니다. 센서 unit을 확인하고, 머신의 표시 온도 단위를 센서의 입력 단위로 혼동하지 않는다. 그래프 절대 온도·RoR·보정은 각각의 단위 변환을 검증한다.

### import 이후 편집에서도 보존할 항목

현재 `initRoasterFormParams → flattenAddressMaps → nestAddressMaps → updateMachine`은 form에 없는 중첩 필드를 다시 저장할 때 버린다. Modbus `signed`·BCD·추가 읽기 센서, S7 BT/ET 외 채널이 해당한다. import에서 `signed=true`를 넣는 것만으로 완료하면 이후 편집에서 unsigned로 바뀔 수 있다. [form 변환](../../src/entities/machine/addressMap.ts), [form 조립](../../src/entities/machine/lib.ts)

같은 protocol의 편집은 검증된 기존 읽기 설정을 보존하면서 사용자가 바꾼 필드만 덮도록 보완한다. 초기 지원에 필수인 signed는 표시·저장 양방향에서 유지한다. protocol 변경 시 예전 주소 맵을 옮겨 붙이지 않고, 사용자가 ET를 비우면 기존 ET를 복원하지 않는다. vendor 객체나 쓰기 설정을 일반 spread로 보존하지 않는다.

구현 위치는 DB 해독·로컬 읽기 API를 Python sidecar, 머신 변환을 machine entity, 그래프 변환을 active-roast feature에 두고 widget에서 미리보기·적용을 조합한다. features 간 직접 import를 만들지 않는다. 기존 authenticated sidecar 호출·머신 저장·그래프 저장을 재사용하고, 적용 완료를 확인하는 데 필요한 저장 결과 처리만 보완한다.

완료 조건은 **소스 → FC 변환 → 편집 → 저장 → 재시작 → adapter 입력**까지 값·의미가 유지되는 것이다. 합성 snapshot의 머신 덮어쓰기·삭제·compaction, signed 음수와 scale, S7 DB/offset/slot, 단위·미지원 보정, host만 편집, ET 삭제, 재import 중복, 제어 설정 미상속을 테스트한다. 예를 들어 integer register 2500·decimalPlace 1·°C는 FC에서도 250.0°C여야 한다. Intel·ARM 배포 패키지의 파일 탐색·해독을 확인한 뒤 지원 머신의 실제 측정값을 대조한다.

## 자동 탐색 구현 순서와 착수 조건

사용자 요청에 따라 **macOS의 Firescope를 먼저 진행하고 Intel·Apple Silicon을 포함한다.** 알려진 userData 경로의 자동 탐색 → 앱 종료 확인·DB 복사 → 허용 설정 해독 → 데모 제외·머신 ID별 과거 설정 복구 → 그래프·머신 후보 미리보기까지를 첫 범위로 삼는다. 현재 캐시와 과거 후보를 구분하고 최신값 처리와 이력 복구를 별도 검증한다. 이번 로컬 자료는 그래프 추출과 과거 실제 머신 schema 검증에 사용할 수 있지만, 현재 머신이 데모이므로 지원 머신 설정을 현재 값으로 저장한 합성 snapshot과도 대조해야 한다. Windows·Cropster·Artisan 자동 탐색은 후속 범위다. 이는 현재 증거에 따른 구현 제안이며 앱 기능을 추가한 것은 아니다.

공통 흐름은 **로컬 자동 탐색 → 제품/버전 판별 → 자동 읽기·허용 설정 추출 → FC 매핑 미리보기 → 선택 항목 적용**이다. 정상 흐름에서 파일 선택은 생략한다. fallback만 설정 파일 또는 논리적인 설정 export를 입력으로 한다. 임의 JSON·CSV·`.alog`나 단일 LevelDB `.log`가 설정 import fallback이 되지는 않는다. 읽을 저장소가 없으면 다른 PC의 설정 파일을 선택하거나 기존 머신 form에서 수동 입력한다.

| 제품 | 구현 전 필요한 최소 검증 |
|---|---|
| Firescope | macOS Intel·ARM 패키지 실행과 decoder 의존성 검증; 지원할 실제 runtime 버전에서 IndexedDB API와 해독값 대조; harmless 그래프 설정 변경·머신 전환·unset 전후 snapshot |
| Cropster | 실제 설정된 root `preferences.json`·`machine.json`·관련 Java Preferences의 비식별 샘플; version/source/channel schema와 읽기 우선순위 |
| Artisan | 지원 버전별 native defaults·OS 저장소·fallback 우선순위; 연결 protocol·배열·Unicode·지원 dtype; `.aset`는 파일 fallback 검증 |
| 공통 | 지원할 Windows/macOS에서 파일 탐색·포트 재선택·FC 저장 후 재시작 유지; 지원 머신에서 측정값 대조 |

Firescope decoder fixture에는 같은 키 덮어쓰기·삭제, WAL에만 최신 값, compaction, orphan table, 서로 다른 DB/store의 동명 키, Unicode, 잘린 파일, external blob 누락, 앱 실행 중 복사 거부, 미지원 runtime을 포함한다. 예상값은 Chromium의 논리값으로 정한다. raw DB나 사용자 식별·인증 자료는 fixture에 넣지 않고 합성 snapshot을 사용한다. [Chromium 명세](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md), [LevelDB 구현](https://github.com/google/leveldb/blob/main/doc/impl.md)

## macOS Firescope 구현 상태 (2026-10-10)

설정 → 로스팅 → 가져오기에 자동 탐색·미리보기·선택 적용을 구현했다. Python 표준 라이브러리만 사용하는 reader가 원본 DB를 읽기 전용으로 잠그고 복사본을 검사한다. CURRENT/MANIFEST의 활성 SST/WAL, CRC32C, Snappy와 IndexedDB schema 5 / Blink 16–21 / V8 15의 일반 객체·문자열을 지원한다. JSON 두 번 파싱이나 raw 문자열 검색을 사용하지 않는다. 외부 blob, 새 포맷, 미완료 Chromium scope/undo/cleanup 작업은 적용을 거부한다.

현재 로컬 복사본에서 그래프와 실머신 3대의 ID별 마지막 설정을 복구했다. 데모는 제외하고 현재 머신과 과거 후보를 별도로 표시한다. source version은 DB만으로 확인되지 않아 null이다. ID는 비어 있지 않은 문자열 또는 JavaScript safe integer를 원래 타입으로 보존한다. 누락·잘못된 ID와 중복 BT/ET는 적용을 차단한다.

일반 Modbus 및 EasysterSmart의 RTU/ASCII/TCP/UDP integer FC3/4, S7 Ethernet TCP INT/REAL을 명시적으로 변환한다. 주소에 보정을 더하지 않으며 Modbus signed=true, decimalPlace 0/1/2, sensor unit을 유지한다. S7은 °C 센서만 지원한다. 보정 0, 필수 통신 설정이 확인된 경우에만 머신을 적용한다. 전용 Probat/Phidget/Diedrich/Bullet 동작과 float/BCD·보조 채널은 미지원 이유를 사용자용 문구로 보여준다. 원본 키·주소 목록은 가져오기 화면에 노출하지 않는다. 새 머신은 custom key, 빈 capabilities, PID 없음, 쓰기 맵 없음으로 저장되며 자동 연결하지 않는다. signed 값은 기존 머신 편집 폼에서도 보존한다.

그래프는 온도 단위·축 범위, 시간 범위·눈금, BT/ET/RoR 색상, ET 표시를 변환한다. 라이브 축의 단위는 최신 머신의 temperatureUnit이고, 이력 표시에서는 global.temperature를 사용하므로 화면에서 단위를 확인할 수 있다. RoR 계산·평활화, 이벤트 감지와 보조 그래프는 동등성을 확인하지 못해 건너뛴다. 미리보기는 사용자용 설정명과 변경 전후 값을 표시한다. 기존 선 두께·스타일과 매핑하지 않은 FC 설정을 유지한다.

머신 source ID로 재가져오기 중복을 막고 기존 플랜 한도를 검사한다. 그래프는 저장 성공 후 화면에 적용하며 실패한 LazyStore 캐시는 복원한다. 머신은 한 batch로 저장하고 실패하면 메모리 상태를 복원한다. 두 저장소 사이의 원자적 트랜잭션은 제공하지 않으며 그래프 저장 뒤 머신 저장이 실패하면 부분 성공을 명시한다.

합성 DB decoder 테스트 31개와 전체 sidecar 테스트 527개가 통과했다(기존 skip 3개). 브라우저 테스트 4개에서 자동 탐색·미리보기·적용·재실행 저장 유지·중복 방지·플랜 한도·저장 실패와 장비 자동 연결 없음도 확인했다. Apple Silicon PyInstaller 패키지를 임시 디렉터리에 빌드하고 실제 로컬 DB를 읽는 authenticated HTTP smoke에서 머신 3대와 그래프 50–250°C/720초를 대조했다. 이 검증은 FC 설치 번들 전체의 검증이나 실기기 연결 테스트를 대체하지 않는다.

실제 로컬 머신 3대는 숫자형 ID를 사용한다. 최초 매퍼가 문자열만 허용해 모두 적용 불가로 표시하는 오류를 재현하고 수정했다. 수정 후 3대 모두 매핑되며 선택된 통신 설정과 BT/ET Modbus register·unit ID·FC·scale 및 S7 DB·offset·type·scale가 원본과 일치하는 것을 확인했다. 머신 단위 테스트 26개와 브라우저 테스트 4개가 통과했으며, 숫자 `42`와 문자열 `"42"`를 구분한 재실행 중복 방지도 검증했다. 지원하지 않는 보조 채널은 계속 건너뛴다.

Artisan의 macOS native plist·기본값 생략·연결 매핑 추가 조사는 [별도 문서](artisan-settings-import-feasibility.md)에 정리했다.

## 미검증·잔여 위험

Windows/macOS 전체 조합, 실제 Cropster 사용자 설정, Artisan native 설정의 앱 버전·defaults 복원, 브라우저 논리값 대조, Intel 배포 실행과 실제 로스터 측정값 대조는 확인하지 않았다. 가장 큰 위험은 과거·기본값을 현재 설정으로 오인하거나 센서 역할·단위·scale·보정을 바꿔 적용하는 것이다. 지원 범위 밖의 설정은 자동 적용하지 않는다. 로컬에 남지 않은 과거 머신은 복구할 수 없다.
