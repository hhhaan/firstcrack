# MOBILE — 태블릿 앱 (iPad / Android 태블릿) 빌드·배포

데스크톱(Tauri v2)과 **같은 레포, 같은 프론트엔드**로 iOS/Android 앱을 빌드한다.
데스크톱 릴리스(`v*` 태그, `release.yml`)와 모바일 릴리스(`app-v*` 태그, `release-app.yml`)는 **완전 분리**.

## 아키텍처 원칙

- 모바일에는 **Python 사이드카가 없다.** iOS/Android는 자식 프로세스 스폰 불가(shell 플러그인은 URL open만 지원).
- 하드웨어 연동은 LAN 사이드카 허브(데스크톱 앱이 떠 있는 PC 또는 라즈베리파이)에 HTTP로 접속한다.
  `SIDECAR_BASE`(`src/shared/lib/sidecar.ts`)를 설정값으로 바꾸는 작업이 선행 조건.
- 데스크톱 전용 코드는 Rust `#[cfg(desktop)]` / Cargo `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`로 게이트한다.
  게이트 누락은 CI `ios-check` 잡(`cargo check --target aarch64-apple-ios`)이 잡는다.

## 현재 상태 (선구축 완료 항목)

- [x] 데스크톱 전용 의존성 분리: single-instance / updater / process / tokio
- [x] `lib.rs` 사이드카 스폰·워치독·좀비킬 `#[cfg(desktop)]` 게이트
- [x] `externalBin` → `tauri.macos.conf.json` / `tauri.windows.conf.json` 이동 (모바일 번들에서 제외)
- [x] `capabilities/mobile.json` (shell/updater/process 권한 제외)
- [x] CI `ios-check` 잡 — 모바일 컴파일 회귀 방지
- [x] `release-app.yml` — 모바일 릴리스 파이프라인 (아래 전제 충족 전까지는 gen/ 부재 에러로 실패하는 게 정상)

### 남은 전제조건 (첫 스토어 업로드 전)

- [ ] `pnpm tauri ios init` / `pnpm tauri android init` 실행 → `src-tauri/gen/` 커밋
- [ ] Android `gen/android/app/build.gradle.kts`에 release signingConfigs 패치 (아래 §Android 서명)
- [ ] `SIDECAR_BASE` 설정화 + 허브 주소 입력 UI
- [ ] 반응형/터치 UI (현재 최소 1260×810 데스크톱 레이아웃)
- [ ] 모바일 CSP: LAN 허브 접속용 connect-src 조정 (`tauri.ios.conf.json` / `tauri.android.conf.json`)

## 최초 1회 설정

### iOS (Apple Developer 계정 보유)

1. **로컬 프로젝트 생성**: Xcode 로그인 상태에서 `pnpm tauri ios init` → `src-tauri/gen/apple` 커밋.
   실기기 테스트: `pnpm tauri ios dev` (자동 서명).
2. **App Store Connect**: appstoreconnect.apple.com → 앱 등록 (번들 ID `com.han.firstcrack`).
3. **API 키 발급**: Users and Access → Integrations → App Store Connect API → 키 생성(App Manager 권한).
   `.p8` 파일은 **1회만 다운로드 가능** — 안전한 곳에 보관.

### Android

1. **로컬 프로젝트 생성**: Android Studio(SDK+NDK) 설치 → `pnpm tauri android init` → `src-tauri/gen/android` 커밋.
2. **keystore 생성** (분실 시 앱 영구 갱신 불가 — 비밀번호 포함 2곳 이상 백업):
   ```bash
   keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```
3. **서명 패치**: `gen/android/app/build.gradle.kts`의 `buildTypes` 앞에 `signingConfigs` 추가 —
   `keystore.properties`(keyAlias/password/storeFile)를 읽어 release에 연결.
   공식 가이드: https://v2.tauri.app/distribute/sign/android
   `keystore.properties`와 `.jks`는 **커밋 금지** (CI가 Secrets로 생성).
4. **Play Console** ($25 1회): 앱 생성 → **첫 AAB는 콘솔에서 수동 업로드** (Play API는 기존 앱에만 업로드 가능).
   로컬 빌드: `pnpm tauri android build --aab`
5. **서비스 계정**: Play Console → API 액세스 → 서비스 계정 생성 → JSON 키 발급 → 앱에 릴리스 권한 부여.

### GitHub Secrets

| Secret | 내용 |
|---|---|
| `APPLE_API_ISSUER` | App Store Connect API Issuer ID |
| `APPLE_API_KEY_ID` | API 키 ID |
| `APPLE_API_KEY_P8` | `.p8` 파일 base64 (`base64 -i AuthKey_XXX.p8`) |
| `ANDROID_KEY_BASE64` | keystore `.jks` base64 |
| `ANDROID_KEY_ALIAS` | keystore alias (예: `upload`) |
| `ANDROID_KEY_PASSWORD` | keystore 비밀번호 |
| `PLAY_SERVICE_ACCOUNT_JSON` | 서비스 계정 JSON 전문 |

## 지속 배포 루틴 (업데이트할 때마다)

### 버전 정책

- 버전 숫자는 데스크톱과 **공유**(`tauri.conf.json` SSoT), 배포 주기는 **독립**.
- **모바일 릴리스는 반드시 버전 범프 후 태그.** 스토어는 같은 버전(iOS CFBundleVersion / Android versionCode) 재업로드를 거부한다.
  Android versionCode는 버전에서 자동 파생(major×1,000,000 + minor×1,000 + patch)이라 버전만 올리면 된다.
- `pnpm release <ver>`는 `v<ver>` 태그를 push해 **데스크톱 릴리스를 발동**시키므로 모바일 단독 배포에 쓰지 말 것.

### 모바일 단독 배포 (기본: Actions 수동 실행)

1. `pnpm version:bump <major.minor.patch>` → 커밋 → push (버전 범프 필수 — 스토어가 동일 버전 거부)
2. GitHub → Actions → **Release App (iOS/Android)** → Run workflow
   - `upload` 체크 안 함: 빌드만, ipa/aab 아티팩트 확인용
   - `upload` 체크: 빌드 + **TestFlight + Play 내부 트랙** 업로드

태그 기반 자동화도 열려 있음: `git tag app-v<ver> && git push origin app-v<ver>` → 빌드 + 업로드.

### 스토어 반영 (수동 — 의도적)

| 스토어 | CI가 하는 것 | 수동으로 하는 것 | 심사 소요 |
|---|---|---|---|
| App Store | TestFlight 업로드 | TestFlight 배포 → 프로덕션 심사 제출 | 심사 1~2일 |
| Play | 내부 트랙 업로드 | 내부 테스트 → 프로덕션 승격 | 수시간~수일 |

프로덕션 제출을 수동으로 두는 이유: 심사 리젝 대응·단계적 출시(스토어 콘솔의 staged rollout)를 사람이 판단.

### 데스크톱 vs 모바일 릴리스 비교

| | 데스크톱 | 모바일 |
|---|---|---|
| 트리거 | `v*` 태그 (`pnpm release`) | Actions 수동 실행 (또는 `app-v*` 태그) |
| 워크플로우 | `release.yml` | `release-app.yml` |
| 배포 채널 | R2 자체 업데이터 (즉시) | 스토어 (심사 후) |
| 산출물 | dmg / msi | ipa / aab |

## 트러블슈팅

- **altool 인증 실패**: `.p8` base64 인코딩 확인, 키 권한이 App Manager 이상인지 확인.
- **Play "versionCode already used"**: 버전 범프 없이 재태그한 것 — `pnpm version:bump` 후 새 `app-v*` 태그.
- **iOS 빌드에서 서명 에러**: `gen/apple` init 당시 팀 설정 확인. CI는 API 키 기반 자동 서명(`APPLE_API_*` env)을 쓴다.
- **모바일 컴파일 깨짐**: 데스크톱 전용 코드가 게이트 없이 추가된 것 — `ios-check` CI 로그 확인, `#[cfg(desktop)]` 추가.
