# 로스팅 설정 reader의 Rust 이전 적합성

조사일: 2026-10-11. 공식 문서·업스트림 소스 확인과 현재 reader 소스 열람에 근거한 조사이며, 이식 구현·성능 측정 결과는 아니다. 아래의 **사실**과 **판단**을 구분한다. 업스트림 `main`/`latest`의 동작이 현재 설치된 타사 앱 버전과 같다고 가정하지 않는다.

## 프로젝트 코드와 직접 확인한 결과

- **기존 Rust 기반:** `src-tauri/Cargo.toml`은 Tauri 2와 `serde`·`serde_json`을 이미 사용한다. 조사 시 `Cargo.lock`에는 Tauri 2.11.1, serde_json 1.0.151, plist 1.9.0이 잠겨 있다. plist는 현재 직접 의존성이 아니므로 앱 reader에서 사용하려면 직접 선언이 필요하다. 새 언어·별도 런타임을 도입하는 작업은 아니다. [manifest](../../src-tauri/Cargo.toml), [lockfile](../../src-tauri/Cargo.lock)
- **이관 범위:** Firescope는 scanner·필터 174줄, IndexedDB/V8 decoder 224줄, LevelDB decoder 265줄로 총 663줄이다. Artisan 152줄, Cropster 234줄까지 합하면 현재 Python 구현은 1,049줄이다. 줄 수는 개발 기간 추정치가 아니며, Firescope의 주요 비용은 포맷·거부 동작 보존이다. [Firescope](../../src-tauri/sidecar/firescope_import/), [Artisan](../../src-tauri/sidecar/artisan_import.py), [Cropster](../../src-tauri/sidecar/cropster_import.py)
- **기존 코드 검증:** 현재 macOS에서 `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`의 기존 Rust 테스트 6개와 세 importer의 pytest 45개가 통과했다. Rust 6개는 Sentry 정제와 사이드카 준비 감시 테스트이며, 새로운 Rust importer를 검증한 결과는 아니다.
- **포맷 실험:** 프로젝트의 빌드된 `plist`·`serde_json` 라이브러리를 연결한 임시 Rust 프로그램으로 Python이 생성한 binary/XML plist를 모두 읽었다. 문자열·정수·Data 바이트가 보존됐다. 기본 `serde_json::Value`는 중복 `version` 키의 마지막 값을 선택했다. 따라서 plist 해석의 실행 가능성은 확인됐고 Cropster의 중복 키 거부는 별도 구현이 필요하다. 이 실험은 허용 목록·QSettings 변환·전체 scanner의 호환성을 보증하지 않는다.
- **잠금 실험:** Rust 1.94.1에서 별도 프로세스의 Python `fcntl.lockf`가 exclusive lock을 보유한 동안 Rust `File::try_lock_shared()`도 잠금 획득을 거부했다. 임시 파일만 사용했다. 현재 macOS 실행 환경의 호환성 근거이며, 실제 Chromium DB 및 다른 OS·파일시스템을 검증한 결과는 아니다.
- **CI 공백:** 현재 CI는 Ubuntu의 `cargo clippy --locked --all-targets`를 실행하지만 Rust unit test 실행 job은 없다. macOS 전용 reader를 추가하면 해당 OS에서 테스트를 실행하는 검증이 필요하다. iOS check는 `IOS_CHECK` 변수로 선택 실행된다. [CI](../../.github/workflows/ci.yml)
- **남는 비용:** 가져오기만 옮겨도 serial/S7/Modbus/Phidget/BLE 등 장비용 Python 의존성과 PyInstaller 배포는 유지된다. 모바일은 로컬 Python 대신 LAN 사이드카 허브를 사용하는 설계이므로 장비 통신 HTTP 경로를 함께 없애는 작업은 아니다. [의존성](../../src-tauri/sidecar/requirements.txt), [모바일 설계](../MOBILE.md)

## 결론

**판단:** Tauri Rust command는 로컬 설정 탐색에 적합한 실행 위치다. 그러나 세 reader의 일괄 재작성까지 정당화하지는 않는다. Artisan(plist)·Cropster(JSON)는 비교적 표준적인 이식 후보이고, Firescope는 Chromium 저장 포맷을 해석하는 별도 호환성 프로젝트다. 작은 두 reader부터 기존 결과와 대조하고 Firescope는 별도 판단하는 편이 합리적이다. HTTP 405가 오래된 sidecar 프로세스에서 발생했고 최신 reader가 정상 동작했다는 관찰만으로 파서 재작성 필요성이 입증되지는 않는다.

## 권고 범위와 순서

현재 프로젝트에 대한 권고는 역할별로 다르다. 이는 위 코드·실험과 아래 공식 자료에 근거한 설계 판단이다.

| 역할 | 권고 | 이유 |
| --- | --- | --- |
| OS 경로·로컬 설정 파일 조회 | Rust command | 기존 Tauri 실행 경계를 재사용하고 장비용 서버의 실행 상태와 분리할 수 있다. |
| 장비 연결·센서 수집·제어 | Python 유지 | 현재 드라이버·복구·제어 코드와 장비 의존성을 이관할 근거를 이번 조사에서 확인하지 않았다. |
| 설정 변환·미리보기·선택·저장 조합 | 기존 TypeScript/FSD 유지 | 이번 변경의 목적은 reader 실행 위치이며, 검증된 도메인 변환·저장 구조를 다시 쓰는 것이 아니다. |

1. **Cropster:** 기존 JSON 파서를 활용하되 재귀적 중복 키 거부와 기존 snapshot·파일 검증을 먼저 대조한다.
2. **Artisan:** 조사 시 이미 잠긴 plist 라이브러리를 직접 의존성으로 선언하고 binary/XML·QSettings·정제 결과를 대조한다.
3. **Firescope:** 자동 이관 확정 대신 별도 호환성 검증 단계로 둔다. 현재 decoder의 합성 입력·손상 입력과 실제 macOS DB snapshot에서 결과·거부 상태·원본 보존이 동일한지 확인한 뒤 전체 이관을 결정한다. 검증 실패 시 기존 reader를 유지한다.

따라서 [#758](https://github.com/hhhaan/firstcrack/issues/758)의 세 reader 이관 계획은 단계별 완료 조건으로 나누고, Firescope는 별도 결정 지점으로 두는 편을 권고한다. 이번 조사에서는 이슈 본문과 제품 구현을 변경하지 않았다.

## Tauri 실행·보안 경계

- **사실:** 일반 동기 command는 메인 스레드에서 실행되고, async command는 별도 async task에서 실행된다. 파일 복사·해시·동기 파싱은 `tauri::async_runtime::spawn_blocking`의 전용 실행기로 보낼 수 있다. **판단:** `async fn`만 붙이는 것으로 blocking 작업의 실행 위치까지 해결했다고 보면 안 된다. [Tauri commands](https://v2.tauri.app/develop/calling-rust/#async-commands), [spawn_blocking](https://docs.rs/tauri/latest/tauri/async_runtime/fn.spawn_blocking.html)
- **사실:** Tokio의 실행 중인 blocking task는 `abort`로 중단되지 않는다. **판단:** 호출 시간초과만으로 파서가 종료된다고 가정하지 말고, 입력 크기·노드 수·깊이·동시 스캔 제한을 보존해야 한다. [Tokio 문서](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)
- **사실:** 앱에 등록한 custom commands는 기본적으로 앱의 모든 window/webview에서 허용된다. 제한하려면 `AppManifest::commands`와 capability 설계를 적용해야 한다. fs plugin의 프런트엔드 접근 범위와 Rust `std::fs`의 파일 접근은 별개다. **판단:** 범용 경로를 받는 reader 대신 고정된 제품·기본 경로만 읽고 허용 필드만 반환하는 command가 적합하다. IPC로 옮겼다는 이유만으로 자동 보안 강화라고 표현하면 안 된다. [Capabilities](https://v2.tauri.app/security/capabilities/), [fs plugin Rust API 설명](https://v2.tauri.app/plugin/file-system/#usage)
- **사실:** Tauri core가 OS 접근을 담당한다. `mockIPC`는 실제 Rust backend를 실행하지 않는다. **판단:** 순수 브라우저의 `pnpm dev`에는 desktop 탐색의 fallback/미지원 처리 또는 mock이 필요하다. 프런트엔드 mock 통과는 실제 파일·락·파서 검증을 대신하지 못한다. [Process model](https://v2.tauri.app/concept/process-model/), [Mock APIs](https://v2.tauri.app/develop/tests/mocking/)

## 포맷별 이전 난도

| Reader | 확인된 근거 | 이전 시 보존할 계약 / 판단 |
| --- | --- | --- |
| Artisan | `plist::Value::from_reader`는 seekable byte stream의 plist encoding을 읽는다. Rust에 표준적인 파서 선택지가 있다. | 제한된 바이트를 먼저 읽고 parsing. plist의 Data/Date/UID/정수/비유한 실수 처리와 기존 허용 필드 정제를 그대로 대조해야 한다. 비교적 작은 후보. [plist Value](https://docs.rs/plist/latest/plist/enum.Value.html) |
| Cropster | 프로젝트는 이미 `serde_json`을 사용한다. 그러나 `serde_json::Value`의 object 역직렬화는 `Map::insert`를 사용해 중복 키를 덮어쓴다. | 현재 Python의 중첩 object 중복 키 거부가 자동 보존되지 않는다. 재귀적 중복 검사, 파일 크기 제한, 숫자·최상위 shape·두 파일 버전 일치 검증을 명시해야 한다. [serde_json 소스](https://docs.rs/serde_json/latest/src/serde_json/value/de.rs.html) |
| Firescope | Chromium IndexedDB는 custom comparator와 고유 key encoding을 쓰고, 값은 Blink/V8 serialization까지 해석해야 한다. | 일반 LevelDB crate 지원은 이 포맷 지원의 증거가 아니다. MANIFEST/WAL/SST, checksum/Snappy, sequence/tombstone, IDB metadata, Blink/V8 version·reference·host-object 거부를 포함한 호환성 검증이 필요하다. [Chromium IDB 포맷](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/indexed_db/docs/leveldb_coding_scheme.md), [Blink 소스](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/bindings/core/v8/serialization/serialized_script_value.h), [V8 소스](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/objects/value-serializer.cc) |

**사실:** LevelDB의 일반 `DB::Open`/복구 경로는 새 log·table 작성 등 변경 작업을 수행할 수 있다. Chromium scopes에는 종료 후에도 undo/cleanup을 요구하는 상태가 있다. **판단:** 원본 DB를 일반 엔진으로 여는 것은 현재의 읽기 전용 snapshot 파서와 동등하지 않다. 복사본에 엔진을 사용하더라도 comparator·IDB scopes·V8 의미가 자동 해결되지는 않는다. 기존의 복구 필요 상태 거부를 없애면 안 된다. [LevelDB 구현](https://github.com/google/leveldb/blob/main/db/db_impl.cc), [Chromium scopes 설계(123.0.6312.86)](https://chromium.googlesource.com/chromium/src/+/123.0.6312.86/components/services/storage/indexed_db/scopes/)

## 락 호환성은 별도 검증 대상

**사실:** LevelDB POSIX 구현은 전체 파일에 `fcntl(F_SETLK)` write lock을 사용한다. Chromium의 POSIX 파일 락도 `F_SETLK`를 사용한다. 반면 Rust `fs2`는 Unix에서 `flock(2)`를 사용한다. Linux 로컬 파일의 `flock`과 `fcntl`은 서로 충돌하지 않으며 BSD·네트워크 파일시스템 등에서는 동작이 다를 수 있다. [LevelDB POSIX 소스](https://github.com/google/leveldb/blob/main/util/env_posix.cc), [Chromium POSIX 소스](https://github.com/chromium/chromium/blob/main/base/files/file_posix.cc), [fs2 문서](https://docs.rs/fs2/latest/fs2/trait.FileExt.html), [Linux man-pages 원본](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/heads/master/man/man2/flock.2)

**로컬 실험:** 조사 담당 주 에이전트가 현재 macOS/Rust 1.94.1에서 별도 Python 프로세스의 exclusive `fcntl.lockf` 락을 잡았을 때 Python shared `fcntl`과 Rust `std::fs::File::try_lock_shared()`가 모두 차단됨을 확인했다. 따라서 현재 환경의 Rust 표준 락이 호환되지 않는다고 주장할 근거는 없다. 이 결과를 Linux·Windows 또는 다른 helper로 일반화하지 않는다.

**판단:** 현재 `fcntl.lockf`를 이름이 비슷한 generic Rust shared-lock helper로 바꾸면 플랫폼에 따라 호환성이 깨질 수 있다. 실제 Firescope가 사용하는 Chromium 버전과의 충돌 시험은 별도로 필요하다. 이식은 원본 변경 감지·symlink 거부·파일 identity 재확인·해시 재확인·앱 실행 재확인을 함께 보존해야 한다. 파일 락 성공만으로 snapshot 일관성이 증명되지는 않는다.

## 기대 이득의 범위와 완료 조건

- **판단:** desktop reader가 sidecar HTTP route/포트/프로세스 버전과 분리되는 이득은 있다. 하지만 하드웨어 통신이 Python에 남으면 Python packaging·프로세스 관리 자체는 사라지지 않는다.
- **판단:** Rust 파싱은 앱 core 프로세스 안으로 이동한다. 큰 snapshot의 CPU·메모리 비용과 실패 영향도 함께 이동하므로, 별도 프로세스 격리보다 무조건 안전하거나 빠르다고 단정할 수 없다.
- **판단:** native 코드·새 crate·플랫폼별 락 변경은 Rust 재빌드와 macOS arm64/x86_64·Windows 빌드 검증 비용을 만든다. macOS 전용 탐색을 Rust로 옮기는 것만으로 Windows 탐색 지원이 생기지는 않는다.
- **권고:** 기존 Python fixture를 Rust에서도 동일 입력으로 실행해 응답·거부 상태를 대조한다. 특히 duplicate keys, 과대 입력, 손상 snapshot, 삭제·구버전 record, 복구 필요 scopes, 미지원 Blink/V8, 별도 프로세스 락 충돌을 기준으로 삼는다. 웹 mock과 native command smoke test를 구분한다.

미실시: 실제 Rust 이식·벤치마크·제품 버전별 DB 호환성·전체 OS 락 실험·배포 빌드. 이 문서는 실행 환경 이전의 타당성을 평가하며, Firescope 포맷 전체 호환성을 보증하지 않는다.
