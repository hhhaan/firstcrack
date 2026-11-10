# 자동 배출문 열기: 짧은 BT 스파이크 방어 조사

조사일: 2026-11-10. 범위: 물리적인 **Discharge-open action** 판단. Drop mark 자동 감지와 구분한다. 현재 기준은 로컬 `ddd982fc`의 1초 확인 로직이다. 이 문서는 조사 결과이며 제어 조건을 변경하지 않는다.

## 결론

**단일 관측 스파이크는 현재 확인 조건이 막지만, 1초 이상 지속되는 잘못된 높은 관측까지 막는 것은 아니다.** 1초는 현장에서 검증된 안전 시간이나 오발 확률이 아니다. 우선 거부된 값까지 원시 관측·시각·판정 이유를 남기고, 실제 장애 기록에 현행 조건과 후보를 재생 비교해야 한다.

추가 방어 후보는 **최소 관측 수 + 연속 유지 시간**, 다음은 **배출 전용 인과적 median + 현재 원시 BT 확인 + 연속 유지 시간**이다. 히스테리시스나 화면 smoothing으로 대체하는 것은 권하지 않는다. 단일 센서의 정상처럼 보이는 지속 오류는 이 후보들만으로 판별할 수 없다. 아래 수치는 알고리즘의 결정론적 성질이지 현장 안전성 인증이 아니다.

## 현재 코드와 영향 범위

| 위치 | 확인 내용 |
| --- | --- |
| [`btFilter.ts`](../../src/shared/lib/btFilter.ts) | `0 < BT < 400`, 유한값 검사. 직전 정상값 대비 허용 변화량은 `15°C/s × clamp(dt, 0.25s, 10s)`. 처음 값은 범위 내이면 통과. 변화율 초과 후 다음 값이 보류값과 일관되면 새 값부터 통과한다. 이전 거부 관측을 소급 발행하지 않는다. |
| [`useSidecarPolling.ts`](../../src/views/active-roast/model/useSidecarPolling.ts) | 표시 BT와 원시 BT 필터 인스턴스를 구분. Replay용 원시 BT는 read-clock으로 검사하며 반복·역행 시각은 정상 확인에 쓰지 않는다. |
| [`ActiveRoast.tsx`](../../src/views/active-roast/ActiveRoast.tsx) | `rawTemperature.bt`를 `replayBt`로 전달한다. 표시 EMA를 배출 온도로 사용하지 않는다. |
| [`useReplayControl.ts`](../../src/features/machine-control/model/useReplayControl.ts) | 실제 TP 이후, 유효한 새 BT가 임계값 이상이어야 한다. sidecar read-clock과 수신 시각 양쪽에서 1초를 충족하고 인접 간격·현재 관측 나이는 polling의 1.5배 이하여야 한다. 무효·임계값 미만·중단은 확인을 초기화한다. 한 세션 한 번 시도하며 불확실한 전송을 자동 재시도하지 않는다. |
| [`useReplayControl.test.ts`](../../src/features/machine-control/model/useReplayControl.test.ts) | 단일/짧은 스파이크, 500/1000ms 주기, 지터, 빠진 관측, 낡은 관측, 재연결 등의 기존 확인 테스트. 현장 잡음 분포의 검증은 아니다. |

공용 `createBtFilter` 변경은 Replay뿐 아니라 [`useAutoDetection.ts`](../../src/features/active-roast/model/useAutoDetection.ts), [`autoCharge.ts`](../../src/features/active-roast/lib/autoCharge.ts), [`machineLinkNotice.ts`](../../src/features/machine-connection/lib/machineLinkNotice.ts)에도 영향을 준다. 배출 방어를 강화할 때 공용 상수부터 낮추면 Charge 급락·TP/Drop 감지·연결 경고까지 달라진다. 배출 판단 전용 조건을 먼저 비교하는 편이 영향 범위를 명확히 한다.

**현재 수치의 의미:** 500ms 동안 7.5°C, 1000ms 동안 15°C 변화는 위 변화율 조건을 통과할 수 있다. 따라서 목표 부근의 작은 오류도 임계값을 넘길 수 있다. 더 큰 점프도 두 번째 일관된 관측부터 승인될 수 있으므로 변화율 필터와 dwell을 함께 평가해야 한다. 코드 주석의 경험적 설명만으로 모든 로스터·프로브에서 15°C/s가 검증됐다고 볼 수 없다.

## 1차 자료에서 확인한 것

### Artisan: 입력 필터와 표시/RoR 필터는 별개

Artisan 공식 문서는 입력 범위 제한·Drop Spikes가 기록 전 값에 작용하며 제거한 데이터가 남지 않는다고 설명한다. 반면 Delta Span은 RoR 계산에 작용하고, Smooth Spikes는 Optimal Smoothing을 사용하는 사후 처리에 한정된다. 표시가 매끄럽다는 사실을 실시간 배출 판단의 검증으로 사용할 수 없다. 원시값 보존은 장애 분석에도 필요하다. [Artisan Curves](https://artisan-scope.org/docs/curves/)

확인한 소스는 `4ff0cb730844524c083ac08b44847ec164e520f7`로 고정했다. `inputFilter`는 과거 구간의 기울기와 새 구간 기울기를 비교하는 구조이며, 거부값을 직전 값으로 대체하거나 과거 값을 보간하는 경로도 있다. **이 대체값을 새 물리 관측처럼 dwell에 세면 안 된다.** [Artisan inputFilter](https://github.com/artisan-roaster-scope/artisan/blob/4ff0cb730844524c083ac08b44847ec164e520f7/src/artisanlib/canvas.py#L4304-L4390)

문서와 소스의 차이도 발견했다. 이 스냅샷의 spike 조건은 `(pRoR + dRoR_limit) < RoR < (pRoR - dRoR_limit)`이다. 기본 양수 한계 4.2에서는 수학적으로 성립하지 않는다. 또한 `liveMedianBTfilter` 생성·호출은 주석 처리돼 있다. 따라서 이 버전을 근거로 “Artisan의 실시간 median/spike 필터가 이미 입증됐다”고 결론 내릴 수 없다. 전체 버전·장치별 실행을 조사한 결과는 아니다. [기본값과 주석](https://github.com/artisan-roaster-scope/artisan/blob/4ff0cb730844524c083ac08b44847ec164e520f7/src/artisanlib/canvas.py#L1830-L1865), [실시간 호출부](https://github.com/artisan-roaster-scope/artisan/blob/4ff0cb730844524c083ac08b44847ec164e520f7/src/artisanlib/canvas.py#L4745-L4765)

### 시간 확인과 히스테리시스

산업 제어의 on-delay는 조건이 유지된 시간으로 출력을 결정한다. Beckhoff TON은 입력이 false가 되면 경과 시간도 초기화한다. Schneider는 pickup 지연과 dropout 설정을 별도로 둔다. 이는 연속 확인이라는 패턴의 근거이지, 커피 로스터에서 **1초가 적합하다는 근거는 아니다**. 폴링 기반 앱에서는 타이머만 흐르게 하지 않고 새 관측·품질·간격을 함께 검증해야 한다. [Beckhoff TON](https://infosys.beckhoff.com/content/1033/tcplclib_tc2_standard/74406539.html), [Schneider PM800](https://www.se.com/us/en/faqs/FA307786/)

히스테리시스는 켜짐/꺼짐 경계를 나눠 임계값 주변의 반복 전환을 줄인다. 예를 들어 30에서 켜지고 27 미만에서 꺼지는 설정은 최초 30 도달 자체를 지연하지 않는다. 한 번 실행하면 되돌릴 수 없는 배출문 열기에서 최초 스파이크 차단을 대체하지 못한다. 확인 중 낮아진 BT까지 히스테리시스로 유지하면 오히려 “계속 목표 이상” 조건을 느슨하게 만든다. [Schneider Alarm Group](https://product-help.schneider-electric.com/Machine%20Expert/V2.1/en/SoMProg/SoMProg/AlarmGroup-0F191183.html)

### Median, Hampel

Median은 주변 값의 중앙값으로 고립된 impulse를 제거하는 일반적인 방법이다. 실시간에는 미래 샘플을 볼 수 없으므로 최근 N개만 쓰는 **인과적** 창으로 정의해야 한다. 아래 창 크기별 분석은 이 정의에서 직접 계산했다. [MathWorks spike 제거 예제](https://www.mathworks.com/help/signal/ug/remove-spikes-from-a-signal.html)

Hampel은 창 중앙값과 MAD 기반 편차를 이용해 이상치를 식별한다. MathWorks 기본 `hampel`은 앞뒤 3개를 포함하므로 그대로 실시간에 적용할 수 없다. 과거 창으로 바꾸면 상승 추세를 오류로 잡는지, 양자화로 MAD=0이 될 때 어떻게 처리할지, 창 대부분이 오염됐을 때 어떻게 회복할지 추가 검증이 필요하다. 지금은 단순 median보다 우선할 근거가 없다. [MathWorks Hampel](https://www.mathworks.com/help/signal/ref/hampel.html)

## 후보별 오발·미검출·지연의 교환 관계

이 표는 알고리즘 정의에 따른 분석이다. `Δ`는 일정한 샘플 간격이며, median 창은 정상 낮은 관측으로 충분히 채워져 있다고 가정한다.

| 후보 | 줄이는 오류 | 남는 오류 / 비용 |
| --- | --- | --- |
| 현행 1초 연속 확인 | 한 번 높은 값, 확인 중 낮아지는 값, 짧은 높은 구간 | 500ms에서는 높은 3개, 1s에서는 2개로 충족 가능. 샘플 사이 실제 온도는 관측하지 못한다. |
| 연속 시간 + 최소 3개 | 1s 주기의 높은 2개만으로 확인되는 경우 | 1s 주기 정상 반응도 첫 높은 관측부터 최소 2초. 500ms에서는 정주기 기준 현행과 동일. 3개는 비교 후보이지 확정 권장값이 아니다. |
| 최근 3개 median | 고립된 높은 1개 | 연속 높은 2개가 창의 다수가 되면 통과. 정상 단조 상승의 임계값 반응은 원시값보다 Δ 늦어진다. |
| 최근 5개 median | 창 안 높은 값이 최대 2개인 경우 | 높은 3개가 다수면 통과. 정상 단조 상승은 2Δ 지연. |
| m-of-n | 일부 낮은 잡음에도 확인 가능 | 연속성이 없어도 확인된다. 3-of-5는 H/L/H/L/H도 통과하므로 현재 연속 확인보다 엄격한 대체가 아니다. 불규칙 폴링에서는 별도 시간·freshness 제한도 필요하다. |
| median + 원시 BT≥목표 + 1초 dwell | median이 막는 짧은 impulse와 연속 확인을 결합 | 원시값이 낮아지면 반드시 초기화해야 median의 높은 잔상이 배출을 허가하지 않는다. 지연이 더해지며 지속 오류는 여전히 통과한다. |
| 변화율/추세 기반 강화 | 매우 급격한 점프 | 정상 급변과 센서 지연에도 민감하다. 기종·구간별 실측 없이 범용 한계를 낮추면 정상 동작을 보류할 수 있다. |

### 재현 가능한 합성 예시

목표 205°C, 정상 204°C, 오류 또는 계단 206°C. 시각·품질은 모두 유효하고, TP 이후 활성 상태이며 다른 보류 조건은 없다고 가정한다. 변화폭 2°C는 현행 변화율 한계 안이다. H=206, L=204. 표의 시간은 **첫 H 관측부터**, 물리적 임계값 통과부터가 아니다. 실제 센서/수신 지터와 동작 시간은 제외했다.

| 입력 | 간격 | 현행 1초 | 원시 BT 확인 + 3점 median + 1초 |
| --- | --- | --- | --- |
| L,H,L | 0.5s / 1s | 차단 | 차단 |
| L,H,H,L | 0.5s | 차단: H 관측 폭 0.5s | 차단 |
| L,H,H,L | 1s | 두 번째 H에서 허가 가능 | 차단 |
| L,H,H,H,L | 0.5s | 세 번째 H에서 허가 가능 | 차단 |
| L,H,H,H,H,L | 0.5s | 첫 H +1s | 첫 H +1.5s |
| 정상 H 지속 | 1s | 첫 H +1s | 첫 H +2s |

N점 median의 정상 지속 상승 추가 지연은 `(N−1)/2 × Δ`다. 5점 + 1초라면 첫 높은 원시 관측부터 500ms 주기에서 2초, 1s 주기에서 3초가 필요하다. 실제 온도가 샘플 사이에 목표를 넘으면 최대 한 주기 미만의 관측 지연도 별도로 붙는다. 고정 RoR `r`에서 추가 `d`초 동안의 BT 차이는 단순 계산으로 `r × d / 60`°C이며, 예컨대 6°C/min에서 추가 1초는 0.1°C다. 이것도 현장 예측값이 아니라 일정 상승 가정의 산술이다.

## 다음 단계

1. **관측 증거 확보:** 필터 전 `bt_raw`, 표시값, read-clock, 수신 시각, polling 설정, 품질·거부 이유, 목표 BT, 확인 시작/초기화/충족 이유, 재연결·TP·활성 상태, 명령 시도/응답을 연계한다. 거부된 관측도 남겨야 하며, Sentry 이벤트를 샘플마다 생성하는 방식은 피한다. read-clock 증가가 센서의 실제 새 측정을 보증하는지는 어댑터별로 확인한다.
2. **같은 기록으로 명령 없는 재생 비교:** 현행, `1초+최소 3개`, `3점 median+현재 원시 BT+1초`, `5점`을 비교한다. 단발, 2~4개 burst, 목표 근처 왕복, 정상 상승, 지속 높은 오류, 같은 값·새 시각, 오래된 시각, polling 지터·누락·재연결을 포함한다. 시작 창 부족과 세션/연결 경계에서도 과거 값을 섞지 않는다.
3. **측정할 결과:** 잘못 열린 횟수만 보지 말고 실제 목표 통과 후 명령 지연, 정상인데 끝까지 확인되지 않은 경우, 오류 후 회복 시간을 함께 본다. 정답 라벨은 별도 계측/운전자 기록으로 확인해야 한다. 같은 오류 센서의 BT를 정답으로 사용하면 검증이 순환한다.
4. **변경 여부 결정:** 관측된 burst 길이와 허용 배출 지연을 바탕으로 선택한다. 로그가 없는 상태에서 1초를 2초로 늘리거나 median을 추가했다고 “안전”을 선언하지 않는다. 장시간 지속 오류를 구분해야 한다면 센서 진단·독립 측정 등 추가 정보가 필요한지 별도로 판단한다.

현장 원시 오류 분포, 실제 문 열림 피드백, 허용 지연은 이번 조사에서 확보하지 않았다. 따라서 오발 확률·미검출 확률·보장 가능한 안전 시간은 산출하지 않았으며 실제 장비 동작도 시험하지 않았다.
