# 로컬 로스팅 설정 가져오기

설정 조회는 `main` 데스크톱 창의 Tauri IPC에서 실행한다. Python sidecar의 실행 상태·HTTP token·포트 9999에 의존하지 않는다. 장비 연결·센서 수집·제어는 기존 sidecar에 남는다.

| 명령 | macOS에서 읽는 위치 | 반환 필드 |
| --- | --- | --- |
| `read_firescope_settings` | 홈의 `Library/Application Support/Firescope/IndexedDB/file__0.indexeddb.leveldb` | `source`, `graphTemperatureUnit`, `graph`, `indicator`, `global`, `machines` |
| `read_artisan_settings` | 홈의 `Library/Preferences/org.artisan-scope.Artisan.plist` | `source`, `settings` |
| `read_cropster_settings` | 홈의 `CropsterRoastingIntelligence/default/{machine,preferences}.json` | `source`, `machine`, `preferences` |

세 명령은 인자가 없다. 홈 경로는 Tauri path resolver로 구한다. Windows·Linux는 `unsupported` / `platform` snapshot을 반환하고, 브라우저에서는 조회를 실행하지 않는다. Cropster의 사용자 지정 디렉터리·다른 instance는 지원하지 않는다.

공통 snapshot 상태는 `found`, `not-found`, `needs-app-closed`, `unsupported`, `unreadable`이다. 기존 source/version/sourceId·nullable 필드와 제품별 reason을 유지한다. 파서 내부 오류·파일 경로는 응답에 넣지 않는다. 호출 오류는 `settings-scan-timeout` 또는 `settings-scan-failed`로 제한한다.

파일 I/O와 파싱은 blocking worker에서 실행하고 호출은 대기 시간을 포함해 20초에 제한한다. 제품별 스캔은 직렬화한다. 시간 초과가 이미 실행 중인 worker를 강제로 종료하지는 않으며, worker가 끝날 때까지 해당 제품의 다음 스캔은 대기한다.

원본은 읽기 전용으로 열며 심볼릭 링크·비정규 파일·크기 제한 초과를 거부한다. 파일 identity와 재조회 결과를 대조한다. Artisan·Cropster는 파일당 4MiB, Firescope는 파일당 32MiB·총 128MiB·512개로 제한한다. Firescope는 앱 실행 여부와 POSIX DB lock을 확인하고 임시 복사본에서 CURRENT/MANIFEST·SST/WAL·CRC32C·Snappy·IndexedDB/V8을 해석한다. sequence·tombstone을 적용하고 복구가 필요한 scopes 상태는 거부한다. 일반 LevelDB writer는 사용하지 않는다.

Artisan의 binary/XML plist 및 QSettings 형식, Cropster의 재귀적 JSON 중복 키 거부·두 파일 버전 일치 검증을 유지한다. 반환값은 기존 설정 허용 목록으로 제한한다. 계정·인증·재고·프로파일·명령·제어 상태는 가져오지 않는다.

프런트엔드는 기존 Zod 계약·ReactQuery·변환·미리보기·버전 확인·선택·저장·중복·quota 검사를 유지한다. 설정 저장은 장비에 연결하지 않는다.

검증: `cargo test --locked --lib`, `cargo clippy --locked --all-targets -- -D warnings`, `pnpm verify:all`, 세 가져오기 Playwright 시나리오. 2026-10-11 macOS에서 실제 Firescope·Artisan(`found`)과 Cropster(`not-found`)의 Rust 결과를 이관 전 Python과 대조해 snapshot 전체 일치 및 원본 9개 파일의 SHA-256 불변을 확인했다. Cropster `found` 결과는 fixture로 검증했다. CI는 Ubuntu 및 macOS arm64/x86_64·Windows에서 native 단위 테스트를 실행하도록 구성했다. 태그 전 전체 데스크톱 빌드·실행 검증은 별도로 수행한다.

사이드카 바이너리가 없는 환경의 native 단위 테스트는 `TAURI_CONFIG='{"bundle":{"externalBin":[]}}'`를 지정한다. CI의 native 테스트에도 이 설정을 적용하고, PR에서는 기존 Rust 변경 경로 gate를 재사용한다. 앱 패키징은 원래 사이드카 번들 설정을 사용한다.
