# 로스팅 배치 번호: 경쟁 제품 조사와 First Crack 적용안

조사일: 2026-10-21. 공식 문서와 Artisan `v4.2.0` 공개 소스를 확인했다. 앱을 직접 실행하거나 경쟁 제품의 비공개 DB를 조사하지 않았다. 아래의 **제품 사실**과 **First Crack 제안**은 구분한다.

## 결론

배치 번호는 제목에서 추출하는 문자열이 아니라, 로스팅 기록에 저장하는 독립 메타데이터로 다루는 것이 적절하다. Artisan은 이를 파일 저장·보고서에서 명확하게 분리한다. Cropster도 추적용 ID와 이름·프로파일을 별도로 취급한다. Firescope는 고객 요구와 가까운 **프로파일 이름 + 자동 번호 배치명**을 문서화하지만, 번호의 독립 저장 방식까지 공개하지 않는다. [Artisan 저장 소스](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/src/artisanlib/main.py#L17120-L17126), [Cropster 이력 필터](https://help.cropster.com/en_US/roasting/using-the-new-roast-overview-page), [Firescope 프로파일](https://docs.firescope.io/feature/profile)

2026-10-21 고객 통화의 요구는 날짜별 순번이 아닌 **프로파일별 누적 번호**, 선택적으로 표시할 **전체 누적 번호**, 자동 제목 및 History 보존, 로스팅 중 제목·생두 변경이다. 이번 사용자 요청에는 라이브 프로파일 변경 시 해당 프로파일 번호로 전환하는 동작이 추가됐다. 이 요구를 경쟁 제품의 로트 ID나 세션 순번과 혼동하지 않는다.

## 제품에서 확인한 사실

| 제품 | 번호의 의미·형식 | 저장·이력·다른 화면 | 확인하지 못한 부분 |
| --- | --- | --- | --- |
| Artisan | 설치의 배치 카운터와 prefix를 결합한 식별자. 공식 예시는 `P5-3`. 뒤 괄호 숫자는 더 큰 로스팅 세션 안에서의 위치다. START 후 보이고 DROP에서 확정된다. [배치 문서](https://artisan-scope.org/docs/batches/), [공식 Batch Counter 설명](https://artisan-roasterscope.blogspot.com/2015/07/batch-counter.html) | 프로파일 이름 앞, Roast Properties, 파일 이름 제안에 사용한다. `title`과 별도로 `roastbatchnr`, `roastbatchprefix`, `roastbatchpos`, `roastUUID`를 저장한다. [공식 설명](https://artisan-roasterscope.blogspot.com/2015/07/batch-counter.html), [title 저장](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/src/artisanlib/main.py#L17053), [번호 저장](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/src/artisanlib/main.py#L17120-L17126) | First Crack의 레시피별 누적 번호와 같은 기능이라는 근거는 없다. 라이브 프로파일 재지정 때 별도 프로파일 카운터를 어떻게 바꾸는지도 문서화되어 있지 않다. |
| Firescope | 프로파일을 선택하여 시작하면 배치명에 프로파일 이름과 자동 번호가 채워진다. [프로파일 문서](https://docs.firescope.io/feature/profile) | 생성된 배치명으로 로스팅 기록에서 찾을 수 있고, 프로파일 상세에서 해당 로스팅 기록을 모아 검색한다. 전체 기록에서도 배치명 검색과 목록 항목 선택을 제공한다. [프로파일 문서](https://docs.firescope.io/feature/profile), [기록 검색·필터](https://docs.firescope.io/feature/roasting-record-list) | 번호의 독립 필드 존재, 정확한 구분자·자릿수 계약, 프로파일별/전체 범위, 일별 리셋 여부, 삭제·취소 시 재사용, 라이브 프로파일 변경 시 재할당은 확인되지 않았다. |
| Cropster | ID-tag는 두 글자 코드 + 순차 번호다. `PR`은 Production Roast, `SR`은 Sample Roast, `PB`는 Post-roast blend다. 실제 배치 표시는 `PR-xxxx`로 설명한다. [ID-tag 설명](https://help.cropster.com/cropster-glossary), [RI 블렌딩](https://help.cropster.com/en_US/using-roasting-intelligence/how-to-create-blends-in-roasting-intelligence) | 자동 배정된 ID-tag는 추적성을 위해 변경할 수 없다. Roasts overview에는 ID-tag, Name, Profile이 각각 검색 조건이며, 커핑에서도 이름 없이 ID만 쓸 수 있다. [커핑·ID 설명](https://help.cropster.com/en_US/how-to-set-up-a-double-blind-cupping-session), [Roasts overview](https://help.cropster.com/en_US/roasting/using-the-new-roast-overview-page) | `PR` 번호가 프로파일별 누적 횟수라는 근거는 없다. 할당 트랜잭션·계정 간 범위·리셋 정책·라이브 프로파일 재지정 시 번호 변화·비공개 DB 구조도 추정하지 않는다. |

Artisan의 “profile”은 위 설명에서 저장된 로스팅 곡선/기록을 가리키므로, First Crack의 반복 생산용 선택 프로파일과 그대로 대응시키지 않는다. [Artisan 프로파일·보고서 문서](https://artisan-scope.org/docs/roast-reports/)

### 내보내기와 화면 간 재사용

- **Artisan:** 배치 보고서는 HTML·CSV·Excel을 지원한다. `v4.2.0` 소스에서 배치 식별자와 title을 별도 값으로 읽고 CSV 및 Excel의 서로 다른 열에 기록하는 것을 확인했다. 제목을 바꾸더라도 번호를 제목에서 다시 파싱할 필요가 없는 구조다. [보고서 문서](https://artisan-scope.org/docs/production-reports/), [메타데이터 읽기](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/src/artisanlib/main.py#L21818-L21849), [CSV](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/src/artisanlib/main.py#L22110-L22115), [Excel](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/src/artisanlib/main.py#L22209-L22214)
- **Firescope:** PDF 내보내기의 존재는 공식 업데이트 내역에 나온다. 다만 자동 번호가 PDF/구조화 export에서 독립 필드로 보존되는지는 이 자료로 확정할 수 없다. [업데이트 내역](https://docs.firescope.io/update-history)
- **Cropster:** PR 번호로 이력 상세를 열고 Excel·PDF로 내보낼 수 있다. RI의 생산 목록에서도 특정 로스팅 배치 ID 옆에 배출량이 표시된다. 생두 재고 거래 이력은 결과 로스팅의 ID-tag를 Relation으로 참조한다. [내보내기](https://help.cropster.com/3290630), [RI 생산 목록](https://help.cropster.com/en_US/using-roasting-intelligence/how-to-create-blends-in-roasting-intelligence), [재고 거래](https://help.cropster.com/inventory-management/managing-green-inventory)

Cropster의 roast curve `.crc` 내보내기/가져오기는 별도 기능이다. 가져올 때 이름·머신·생두·중량을 다시 입력하는 절차가 있으므로, 곡선 파일이 기존 ID와 모든 메타데이터를 보존한다고 가정하지 않는다. [곡선 export/import](https://help.cropster.com/sharing-exporting-cropster-data/how-to-export-and-import-roasts)

## First Crack 제안 — 경쟁 제품의 확인된 동작이 아님

현재 구현의 번호 원장은 로컬 기기 안에서 workspace·프로파일별로 관리되며, 저장 이력에는 번호가 제목 문자열을 통해 전달된다. 이번 구현 범위는 라이브 프로파일 변경에 맞는 번호 선택과 전체 번호 유지다. 아래의 독립 메타데이터 영구 저장·History 노출은 후속 설계 제안이며, 이번에 구현되었다는 뜻이 아니다. 서버 번호 할당이나 과거 이력 backfill도 이번 범위에 포함하지 않는다.

### 제목과 분리할 값

| 값 | 의미·수명 |
| --- | --- |
| 로스팅/session UUID | 실제 로스팅 한 번의 식별자. 제목·프로파일 변경과 무관하게 유지한다. |
| workspace ID | 번호의 범위. 다른 workspace 번호를 섞지 않는다. |
| profile ID + profile batch number | 현재 선택 프로파일에 배정한 누적 순번. 이름 변경에는 유지하고 다른 프로파일 선택에는 그 프로파일의 번호를 사용한다. |
| total batch number | 실제 로스팅 한 번에 한 번 배정하는 workspace 전체 누적 순번. 프로파일 변경으로 증가하지 않는다. |
| title | 자동 생성 또는 수동 편집한 표시 문자열. `#N`, `Σ#M`은 위 메타데이터의 표현이며 데이터 원본이 아니다. |

현재 고객 요구에 일별 순번·prefix 설정·임의 리셋·새 ID 체계는 필요하지 않다. 번호를 제목에 표시하는 설정을 꺼도 번호 메타데이터는 보존한다. History 행·상세·다른 로스팅 선택 UI는 동일한 저장값을 사용하고, 제목을 수동 변경해도 번호를 잃지 않는다. 서버 기록, 곡선 파일, 로컬 복구 데이터 중 어느 경로로 다시 열든 같은 번호가 복원되어야 한다. 이전 기록에 번호가 없으면 비어 있는 상태를 허용하고 제목에서 추측하여 채우지 않는다.

구체적인 후속 저장안은 `roast_sessions.profile_batch_number`, `roast_sessions.total_batch_number`를 nullable 양의 정수 필드로 추가하고, 최종 `profile_id` 및 `batch_name`과 같은 저장 작업에서 기록하는 것이다. 로컬 복구 체크포인트에도 같은 필드를 포함한다. History·비교·PDF·CSV는 제목 파싱 없이 이 값을 읽는다. 기존 기록의 null은 유지하고, 제목의 `#숫자`를 근거로 과거 번호를 확정하지 않는다.

### 라이브 프로파일 변경

한 세션 안에 프로파일별 예약을 보관한다. 예를 들어 A의 다음 번호가 12, B의 다음 번호가 8, 전체 다음 번호가 91이라면:

| 동작 | 프로파일 번호 | 전체 번호 |
| --- | --- | --- |
| A로 시작 | A #12 예약 | Σ#91 한 번 예약 |
| 진행 중 B 선택 | B #8 예약·표시 | Σ#91 유지 |
| 다시 A 선택 | 기존 A #12 재사용 | Σ#91 유지 |
| A 상태로 저장/재시도 | A #12 그대로 저장 | Σ#91 그대로 저장 |

예약 키는 적어도 session·workspace·profile을 구분해야 한다. 같은 선택을 반복하거나 저장을 재시도해도 증가시키지 않는다. 선택 프로파일과 표시 번호·저장 번호를 함께 변경하고, 자동 제목은 새 조합으로 갱신한다. 수동 제목은 유지하면서 독립 번호만 갱신한다. 프로파일이 없으면 현재 앱의 무지정 프로파일 범위를 사용하며 전체 번호는 유지한다.

**번호의 의미는 누적 순번이지 완료 기록 개수와 항상 같은 값은 아니다.** 현재처럼 예약 시 영구 카운터를 증가시키는 방식에서는 B로 갔다가 A로 돌아오거나 로스팅을 취소하면 빈 번호가 생길 수 있다. 되감아서 다른 로스팅과 번호가 충돌하는 것보다 빈 번호를 허용하는 편을 권장한다. 빈 번호 없는 완료 횟수가 필요하다면 별도의 저장 시 확정 설계가 필요하며, 라이브 예약 번호와 혼용하지 않는다.

로컬 영구 카운터만으로는 여러 기기에서 동일 workspace 번호의 유일성을 보장하지 못한다. 이번 기능의 번호를 UUID 대체 키로 쓰지 않는다. 여러 기기의 전역 유일 순번이 필요해질 때 서버 원자적 할당으로 전환한다.

### 완료 판정에 필요한 확인

수동 제목 변경·번호 표시 설정 해제 후에도 History/상세에 메타데이터가 남는지, A→B→A와 같은 프로파일 재선택에서 번호를 중복 소비하지 않는지, 전체 번호는 한 번만 증가하는지, 저장 재시도·복구·재로드에서 번호와 선택 프로파일이 일치하는지 확인한다.

## 조사 한계

Artisan 소스 확인은 명시한 `v4.2.0`에 한정한다. 일부 공식 안내는 오래된 문서이며 실제 최신 UI와 차이가 있을 수 있다. Cropster ID-tag 페이지는 본문과 함께 archived 안내도 반환하므로, 변경 불가·화면 활용은 다른 현행 공식 문서로 교차 확인했다. 세 제품 모두 **라이브 A→B→A 프로파일 변경 시 번호 예약 규칙**의 직접적인 공식 설명은 찾지 못했다. 이를 미지원이라고 단정하지 않는다.
