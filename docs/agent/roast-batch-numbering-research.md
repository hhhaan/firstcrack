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

## First Crack 적용 기준 (2026-10-22)

사용자 결정에 따라 프로파일별 번호는 해당 프로파일로 새 로스팅을 저장할 때 증가한다. DB가 같은 작업공간의 모든 기기에 대해 저장 트랜잭션 안에서 프로파일별 `#번호`와 전체 `<접두어> #번호`를 발급한다. 전체 번호 접두어는 기기 로스트 세팅이며 기본값은 `PR`이다. 빈 값도 `PR`이다. 프로파일이 없으면 프로파일별 번호는 비운다. Charge·프로파일 재선택·취소·폐기에는 번호를 소비하지 않는다.

저장 전에는 이름만 표시한다. 저장 성공 시 최종 `profile_id`, `batch_name`, `profile_batch_number`, `total_batch_number`를 함께 확정한다. 자동 제목만 선택한 번호 표시 방식을 적용하고, 수동 제목은 그대로 둔다. 번호 표시를 꺼도 독립 번호 필드는 저장한다. 카운터의 시작값은 기존 완료 기록 수를 사용한다. 기존 기록의 번호 필드는 null을 유지하고 제목의 숫자로 과거 번호를 추측하지 않는다.

동일 세션 UUID의 재시도는 기존 저장값을 반환하며 번호를 추가 소비하지 않는다. 실패한 저장은 번호 증가도 롤백한다. 삭제된 번호는 재사용하지 않는다. localStorage는 미저장 로스팅 복구에만 사용하고 번호 원장·사전 예약·지연 병합은 제거한다. 오프라인에서는 DB에 저장할 수 있을 때까지 번호가 미확정인 복구 항목으로 남는다.

History에서는 프로파일을 읽기 전용으로 표시하고 DB도 완료 기록의 프로파일·번호 변경을 거부한다. 제목 변경은 허용한다. 프로파일 삭제의 기존 FK 참조 해제는 유지하며 저장 번호는 남긴다. 사후 프로파일 정정 기능은 이번 범위에서 제외한다.

History·비교·PDF·CSV는 같은 저장 번호를 읽는다. 원본 곡선 TSV는 바꾸지 않고 세션 UUID로 메타데이터와 연결한다. 과거 이력 backfill, 서버 예약 번호, 임의 리셋, 새 ID 체계는 추가하지 않는다.

## 조사 한계

위 경쟁 제품 조사는 명시한 소스와 버전에 한정한다. First Crack의 저장 시 번호 발급 정책은 사용자 결정이며 경쟁 제품 동작의 재현이라고 주장하지 않는다.
