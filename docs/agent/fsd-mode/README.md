# FSD 작업 현황과 재개 순서

2026-10-22 기준. 이 문서는 다른 세션에서 작업을 이어받기 위한 현재 상태다. 세부 구현은 [FSD-02 계약](fsd02-contract.md)을 따른다. 단계별 검증 항목은 [전체 계획](2026-10-22-fsd-mode-plan.md)에 있다.

## 현재 상태

| 항목 | 상태 |
| --- | --- |
| 작업 디렉터리 | `/Users/hanseungheon/han/first-crack-proj/first-crack-fsd-handoff` |
| 브랜치 | `feat/fsd-mode` |
| 인수인계 HEAD | `4787aeb7d6d7db826d44a5e1eb71ed3888e7c131` |
| FSD-01 | 구현, 검증, 로컬 커밋 완료 |
| FSD-02 | 구현 및 독립 검토 결함 수정 완료. 최종 실행·성능·영상 검증 중, 로컬 커밋 대기 |
| FSD-03 | 미착수 |
| FSD-04 | 현재 목표 범위 밖. 물리 장비 튜닝과 활성화 금지 |
| 현재 실행 | 같은 작업 위치에서 FSD-02 검증 중. FSD-03은 FSD-02 커밋 뒤 시작 |

워크트리를 옮길 때 HEAD, 브랜치, 깨끗한 Git 상태와 추적 파일 1,469개의 해시가 같음을 확인했다. 위 HEAD는 이 문서를 추가하기 전 구현 기준이다. 의존성 디렉터리도 함께 이동했다. sidecar `.venv`는 원래 프로젝트의 가상환경을 가리키는 기존 링크를 유지한다.

기존 `first-crack-fsd-mode` 디렉터리는 없다. 과거 검증 로그의 이전 디렉터리는 당시 실행 경로이므로 바꾸지 않는다. 원래 main 체크아웃의 독립 변경은 이 브랜치에 합치지 않았다. 작업 재개 전 최신 main 변경이 실제 수정 대상과 겹치는지 확인한다.

## 만들려는 동작

FSD는 감독하에 사용하는 로스팅 화력 자동 제어다. 기록된 reference roast의 BT를 Charge 이후 같은 경과시간에서 목표로 삼고, 현재 BT와의 오차로 Gas를 조정한다. 기존 PID와 실제 heater 쓰기 경로를 재사용한다.

운영자가 Charge, TP 이전 Gas, Drop, airflow, drum speed를 맡는다. reference와 live의 TP를 raw BT로 각각 확인한 뒤 명시적으로 시작한다. TP 시점을 맞추려고 기준 시간을 이동하지 않는다. v1 lookahead는 0이다.

이번 목표는 FSD-01부터 FSD-03까지의 구현, 격리된 virtual 장비 검증과 단계별 로컬 커밋이다. 물리 장비의 curve capability는 false로 유지한다. push, PR, merge, tag, deploy는 범위 밖이다. 중간 프로토콜과 UI 검토는 증거를 수집한 뒤 계속 진행하며, 별도 사용자 승인 대기로 바꾸지 않는다.

## FSD-01에서 끝낸 작업

로컬 커밋은 다음과 같다.

| 커밋 | 내용 |
| --- | --- |
| `d17de5b8` | heater 소유권, 실제 쓰기 경계, 표본 시각과 연결 종료 보강 |
| `8fa6a872` | 공개 PID fault와 PID 소유 중 fan·drum 검증 |
| `b2af3543` | 실제 PID 쓰기 대기, 고정된 표본의 HOLD·FAULT, 연결 교체 검증 |

`HeaterControlSession`이 heater generation과 쓰기 완료 대기를 소유한다. 수동 인수는 이전 쓰기가 끝나기 전 성공으로 응답하지 않는다. Replay 요청과 retry는 발급 시점의 ticket을 유지한다. Fan과 drum은 heater 소유권을 바꾸지 않는다.

표본의 실제 acquisition timestamp와 sensor clock을 유지한다. 캐시 응답은 필터와 적분을 다시 진행시키지 않는다. 명시적 연결 종료는 쓰기를 기다린 뒤 이전 operation을 폐기하고, 같은 adapter의 자동 재연결은 필요한 최소 명령 의무를 유지한다. 독립 검토에서 재현한 7개 결함을 수정했다.

완료 판단에 사용한 증거는 다음과 같다.

- 전체 검사 `pnpm verify:all` 통과. Sidecar 786개, frontend 2,907개 통과. 기존 frontend skip 1개가 있다.
- 보강한 실제 HTTP 10개 시나리오를 담당자와 root가 각각 통과했다. 정상 token 경계와 임시 loopback port를 사용했다.
- 정확한 `b2af3543`에서 10개 최종 화면과 실제 실행 중 화면을 캡처했다. 정확한 원래 기준 `5c4649e8`에서도 같은 입력을 실행해 비교했다.
- 최종 성능 검증은 교차 실행한 1,000개 HTTP 명령과 실제 virtual 쓰기를 확인했다. 추가 p95 20 ms 예산을 통과했다.
- 성능 실행 후 커밋과 생산 Python 파일 26개의 해시가 같은지 확인했다. 후속 두 커밋은 검증 드라이버만 바꾼다.

이 결과는 FSD-01에만 해당한다. Curve 추종, lease, receipt 저장과 실제 앱의 FSD 동작은 아직 검증하지 않았다. Virtual의 논리 명령 0은 실제 가스 차단이나 소염을 증명하지 않는다.

## 이번 실행의 FSD-02 진행

[실행 순서와 완료 기준](execution-2026-10-22.md), [결정 기록](decisions-2026-10-22.tsv)을 갱신한다. 현재 증거는 `/tmp/swarm-fsd02`에 있다. 완료 전 durable artifact 위치에 보관하고 소스·커밋 해시와 연결한다.

- Frozen reference, 공통 raw filter·TP, 기존 PID의 actuator bounds, 서버 Charge, 독립 lease·reference deadline, receipt journal과 frontend Charge 전달을 구현했다.
- 독립 pure 검토는 기존 PID 대비 120,000회, 별도 TP oracle 50,000 표본, strict reference와 최대 10,000 point를 확인했다. `review-pure.md`에 범위와 해시가 있다.
- Session 독립 검토에서 재현된 7개 결함을 수정했다. 별도 검토자의 78개 focused 검사, 원래 재현 7개와 새 실행 probe 5개가 통과했다. `review-session-final.md`에 증거가 있다.
- Frontend 독립 검토에서 확인한 승인 대기 표본 유실과 Drop 취소 시 원점 유실을 수정했다. 수정 후 독립 검토를 진행한다.
- Root가 고정된 Python 소스에서 FSD-02 실제 HTTP 10개와 기존 FSD-01 HTTP 10개를 각각 통과했다. `final-http.json`, `final-fsd01-regression.json`이 원본 결과다.
- 5회 교차 60초 cadence, 실제 protocol 화면 10개와 30~60초 영상, 최종 전체 gate와 로컬 커밋은 아직 완료로 표시하지 않는다.

## 인수인계 당시 FSD-02 상태

세 담당자가 아래 범위로 조사와 API 합의를 진행했다. 워크트리 이동 직전 Git이 깨끗했으므로 복구할 미커밋 구현은 없다. 다음 세션에서는 새 경로로 담당자를 배정한다. 이전 경로를 가진 에이전트를 그대로 재개하지 않는다.

| 담당 범위 | 수정 대상 | 다음 산출물 |
| --- | --- | --- |
| Pure target와 PID 계산 | 새 `roast_target.py`, 기존 `pid.py`, 관련 pure·PID 테스트 | reference 검증, 공통 filter와 TP, 보간, actuator bounds |
| Session과 protocol | `heater_control_session.py`, `pid_runner.py`, `manager.py`, `main.py`, `config.py`, 관련 adapter와 테스트 | Charge, curve operation, lease, 종결, 상태, receipt |
| Frontend protocol과 Charge | `shared/types/sidecar.ts`, `shared/lib/sidecar.ts`, active-roast의 autoCharge·actions·store, 기존 polling과 callback | 실제 sample key 전달, accepted Charge 저장, 서버 시간 기준 archive |

합의한 pure API 이름은 `MachineIdentity`, `CurveConfig`, `VIRTUAL_CONFIG`, `RawObservation`, `QualifiedTp`, `ControlFilter`, `RawTpState`, `RoastTarget`, `TargetValidationError`, `parse_machine`, `parse_processing`, `parse_target`, `advance_filter`, `advance_tp`다. 구체 필드는 계약과 실제 caller를 대조해 확정한다. `SoftwarePid.update`의 선택적 `output_bounds`는 fixed PID 기본 동작을 유지해야 한다.

Session 담당자는 기존 `PidOperation`을 fixed와 curve의 구분 가능한 형태로 확장한다. Curve operation은 safety ticket으로 전환한 뒤에도 원래 run authority를 보존한다. 실제 송신 사실과 현재 소유자의 `LastApplied` 갱신은 분리한다. 늦게 끝난 이전 명령은 원래 journal에 추가하고 새 소유자의 상태를 덮지 않는다.

### 확정한 구현 조건

- Reference는 실제 기록 세션의 raw Celsius BT, acquisition 시각, sensor clock, processing metadata, machine identity와 명시적 Charge·Drop을 요구한다. Synthetic fallback과 표시용 BT로 대체하지 않는다.
- Point는 10개 이상 10,000개 이하, duration은 1,800초 이하, 연속 표본 간격은 3초 이하다. Acquisition과 elapsed는 각각 증가해야 한다. 입력은 소유권 변경 전에 검증한다.
- 공통 control filter는 `raw-bt-dt-ema-v1`, tau 2초다. 첫 실제 표본으로 시작하고 10초 warmup을 요구한다. 3초 초과 공백은 warmup을 다시 시작한다.
- Raw TP는 5°C 하강, 최소점 경과시간 20초 이상, 최소점보다 2°C 이상 회복한 상태 5초를 요구한다. Fallback TP는 인정하지 않는다.
- 시작은 양쪽 TP, live warmup, 신선한 표본, 같은 machine, 초기 오차 10°C 이내를 요구한다. 시각은 sidecar의 고정된 Charge origin에서 계산한다.
- Manual Charge는 서버의 현재 시각을 사용한다. Auto Charge는 보관된 실제 `(sensor_clock, acquired_at)`를 지정한다. 같은 요청의 재전송은 origin이나 lease를 다시 시작하지 않는다.
- Virtual 설정은 0~100% 출력, 초당 5 percentage points 변화 제한을 사용한다. 제한값을 PID back-calculation 전에 반영한다. 기존 low-Ki 보정과 fixed 동작은 보존한다.
- Lease는 3초이고 보이는 정상 UI가 1초마다 갱신한다. 독립 watchdog과 마지막 쓰기 허용 검사가 만료를 확인한다. 느린 읽기나 쓰기는 제어권 만료를 미루지 못한다.
- Curve stop, fault, Drop, reference 종료와 lease 만료는 같은 writer 경로로 최소 명령을 요청한다. 미완료·불확실 결과를 완료된 OFF로 표시하지 않는다.
- Reference 마지막 실제 표본 이후를 외삽하지 않는다. 따라서 기록된 Drop보다 최대 3초 먼저 reference가 끝날 수 있다.
- Receipt journal은 Charge별 단조 sequence와 2,048개 제한을 둔다. 불확실 응답을 뒤늦은 성공으로 덮지 않고 reconciliation을 추가한다. 유실 구간을 명시한다.
- Curve capability는 실제 virtual thermal 연결에만 허용한다. Scripted demo BT는 화력의 영향을 받지 않으므로 추종 증거로 사용하지 않는다.

수치는 virtual 검증용이다. 물리 로스터에 승인된 튜닝값이 아니다. 외부 numerical prototype의 회복 결과 역시 생산 runner나 실제 앱의 검증을 대신하지 않는다.

### 확인한 기존 코드의 제약

`RawTemperatureSample`과 자동 Charge callback에 sensor clock이 빠져 있다. Polling부터 실제 onset sample key를 전달해야 한다. `useRoastActions`만 바꿔서는 자동 backdating이 성립하지 않는다.

현재 Charge 시 생성하는 chart의 t=0 seed는 acquisition provenance가 없다. 정확히 식별되는 선두 chart seed만 reference에서 제외할 수 있다. 다른 잘못된 row를 버리고 정상 기록으로 취급하면 안 된다. 새 accepted sample anchor에는 실제 raw 값과 provenance를 남긴다.

프로파일 source join은 machine identity를 가져오지 않는다. 기존 DB 필드가 있으므로 FSD-03에서 query와 타입을 확장한다. DB migration이나 두 번째 온도 archive는 필요하지 않다.

기본 virtual 모드는 scripted다. 기존 `/connect`의 `sim: "thermal"`과 fixture machine identity를 사용한다. Thermal TP를 검증할 때는 실제 냉각·회복 또는 명시한 초기 조건의 thermal fixture를 준비한다.

기존 E2E bootstrap은 port 충돌 시 9999 서비스를 재사용할 수 있고, `pnpm dev`의 predev는 9999를 종료한다. FSD 전용 격리 fixture는 이 경로를 사용하지 않는다.

## 단계별 완료 기준

| 단계 | 구현 | 완료에 필요한 검증 |
| --- | --- | --- |
| FSD-02 | Frozen BT reference, 서버 Charge 시간, 기존 PID 기반 곡선 추종, lease, receipt API, 최소 Charge client plumbing | Pure·lifecycle·closed-loop 테스트, 계획의 실제 HTTP 10개 lane, 수치 fixture, 600 tick evaluator와 별도 60초 실제 cadence, 화면과 30~60초 영상, 독립 검토, 로컬 커밋 |
| FSD-03 | 도달 가능한 FSD 진입점, 가용성 사유, 목표·PV·오차·Gas·상태 표시, 수동 인수, view 생명주기, receipt 저장·History | 실제 앱의 시작·추종·인수·정지·저장·재열기, hidden/error/workspace 경계, 중복·gap·late receipt, 키보드와 단위, 계획의 UI 10개 lane, 성능과 30~60초 영상, 전체 검사, 로컬 커밋 |

FSD-03은 기존 `applied_control`과 저장 흐름을 확장한다. 명령 의도, 실제 적용 결과와 Heat feedback을 구별한다. Receipt는 `(charge_id, sequence)`로 중복 제거하고, Drop 이후의 종결 명령과 늦은 reconciliation도 보존한다. Dense PID 기록을 manual Replay plan으로 바꾸지 않으며 기존 event-count guard를 유지한다.

`ActiveRoastRuntime`은 화면 밖에서 수집을 계속할 수 있다. Lease 갱신은 보이는 control view만 맡는다. 숨김, 화면 오류, workspace 변경과 remount가 자동 재시작을 일으키면 안 된다. Feature 간 직접 import를 추가하지 않고 view에서 조합한다.

## 재개 순서

1. 새 워크트리의 HEAD와 Git 상태를 확인하고 이 문서, 세부 계약, 전체 계획을 읽는다. 원래 main의 다른 작업은 보존한다.
2. Pure API와 wire type을 먼저 합의한다. 위 세 범위로 작업을 나누되 manager·runner·session·adapter 쓰기는 한 담당자가 맡는다.
3. FSD-02를 구현하고 focused 테스트를 실행한다. 실패를 실제 원인에서 수정하며 선언한 기준을 낮추지 않는다.
4. 정상 token을 쓰는 격리된 virtual sidecar와 실제 HTTP로 검증한다. 9999, 기존 서비스와 물리 장비에 접근하지 않는다.
5. 실제 동작, 성능, 독립 검토와 프로토콜 화면·영상을 확보한다. 검증한 소스와 커밋의 동일성을 확인하고 FSD-02를 로컬 커밋한다.
6. 그 검증된 부모에서 FSD-03을 구현한다. 실제 앱의 History 재열기까지 검증하고 UI 검토 자료를 남긴다.
7. `pnpm verify:all`을 통과시키고 단계별 증거와 체크리스트를 갱신한다. 전체 목표를 완료했다고 판단하는 시점은 FSD-03까지 끝났을 때다.

기존 설치를 사용한다. 모든 shell 명령은 `rtk`로 시작하고 package manager는 pnpm만 사용한다. 일반 구현은 `gpt-5.6-sol`, 복잡한 제어·아키텍처와 최종 검토는 `gpt-6-astra`로 배정한다. 작업이 실제로 독립적인 경우에만 병렬 agent를 사용한다.

```sh
rtk git status --short
rtk pnpm verify:sidecar
rtk pnpm test src/features/machine-control src/views/active-roast
rtk pnpm typecheck
rtk env VITE_SUPABASE_URL=http://127.0.0.1:1 VITE_SUPABASE_ANON_KEY=local-test-key pnpm verify:all
```

검증용 Supabase URL과 key는 local test 값이다. 외부 고객 서비스에 연결하지 않는다. Browser용 Vite는 `rtk pnpm exec vite --host 127.0.0.1 --port 1420 --strictPort`로 띄우고, 모든 sidecar 요청을 소유한 virtual 서버 또는 명시적 fixture로 한정한다. 충돌하면 다른 소유 port를 선택하고 기존 프로세스를 종료하거나 재사용하지 않는다.

## 문서와 증거 위치

이 디렉터리에는 재개에 필요한 계획과 계약을 보관한다. 이후 구현에서는 이 사본을 갱신한다.

- [단계별 전체 계획과 체크리스트](2026-10-22-fsd-mode-plan.md).
- [FSD-02 wire·수치·세션·receipt 계약](fsd02-contract.md).
- [선택한 아키텍처](fsd-design-selected.md).
- [기존 코드의 데이터 계약 관찰](fsd-source-contract-notes.md).
- [FSD-01 독립 검토와 해결 결과](fsd01-interrogate.md).
- [초기 아키텍처 조사](fsd-architecture-notes.md).

원본 계획, 결정 trail, JSON, 로그, 스크린샷과 prototype 결과는 아래 local artifact 디렉터리에 남아 있다. 이 Git 문서에는 대용량 실행 증거를 복사하지 않았다. Prototype와 skill로 가는 일부 링크는 이 컴퓨터의 절대 경로다.

`/Users/hanseungheon/.codex/agent-store/first-crack/docs`

주요 증거는 다음과 같다.

- [FSD-01 최종 커밋과 증거 매핑](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/01/commit-evidence-b2af.json).
- [실제 검증 범위 보강 보고서](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/01/coverage-completion/coverage-report.md).
- [최종 커밋의 화면과 재현 절차](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/01/live-console-b2af/reproduction.md).
- [원래 기준 커밋의 동일 입력 비교](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/01/live-console-baseline-5c/reproduction.md).
- [최종 성능 검증 보고서](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/01/perf/report-final.md).
- [전체 검사 로그](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/01/root-gate-5.log).
- [워크트리 이동 확인](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-worktree-relocation.json).

Aside browser surfaces는 당시 사용할 수 없어 설치된 Playwright Chromium과 실제 PTY console을 사용했다. `/deslop`, `control-ui`, `control-cli`는 없어서 실행했다고 기록하지 않았다. Native desktop, Windows·macOS 전체 matrix와 물리 장비는 검증하지 않았다.
