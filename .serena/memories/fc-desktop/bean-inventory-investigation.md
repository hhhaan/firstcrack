# FC-Desktop 생두 인벤토리 감소 로직 조사

## 1. createInventoryLog 호출 지점 (총 2곳)

### 1-1. ActiveRoast.tsx (로스팅 완료 시)
**파일**: `src/views/active-roast/ActiveRoast.tsx` (997-1005번 라인)
```typescript
if (selectedBeanId && planBatchHandoff?.batchSizeKg && user) {
    await createInventoryLog({
        user_id: user.id,
        bean_id: selectedBeanId,
        change_grams: -Math.round(planBatchHandoff.batchSizeKg * 1000),
        type: 'roast',
        roast_session_id: savedSession.id,
    });
}
```

**조건분석**:
- `selectedBeanId`: 선택된 생두 ID
- `planBatchHandoff?.batchSizeKg`: **계획 배치의 배치 사이즈**
- `user`: 사용자 정보

**핵심 발견: planBatchHandoff가 없으면 inventory log가 생성되지 않음**

### 1-2. useAddBeanSubmit.ts (빈 추가/재입고 시)
**파일**: `src/widgets/add-bean-modal/ui/useAddBeanSubmit.ts`

#### 'new' 탭 (새 생두 생성) - 69-75번 라인
```typescript
if (stockGrams > 0) {
    await createInventoryLog.mutateAsync({
        user_id: userId,
        bean_id: newBean.id,
        change_grams: stockGrams,
        type: 'purchase',
    });
}
```

#### 'restock' 탭 (재입고) - 96-101번 라인
```typescript
await createInventoryLog.mutateAsync({
    user_id: userId,
    bean_id: selectedBeanId,
    change_grams: amount,
    type: 'purchase',
});
```

---

## 2. planBatchHandoff 없이 일반 로스팅 시 재고 감소 여부

**결론: 감소 로그가 생성되지 않음 (버그 또는 의도적 설계)**

### 일반 로스팅 흐름
1. RoastHeader에서 직접 selectedBeanId 선택
2. loastSession store의 planBatchHandoff는 null
3. 로스팅 완료 후 ActiveRoast의 997번 조건 확인:
   - `planBatchHandoff?.batchSizeKg` → undefined/null (조건 실패)
   - **inventory log가 생성되지 않음**
   - `roast_sessions` 테이블에는 `bean_id`가 저장되지만 재고는 감소하지 않음

### 배치 로스팅 흐름
1. Schedule 뷰에서 "배치 시작" 클릭
2. `useRoastSessionStore.startBatch()`로 planBatchHandoff 설정
3. PlanBatchHandoff 객체:
   ```typescript
   {
       planBatchId: string
       planId: string
       beanId: string | null
       beanName: string
       batchSizeKg: number  // ← 조건의 핵심
       profileId: string | null
       batchCount: number
       completedSessions: number
   }
   ```
4. 로스팅 완료 후 997번 조건 만족:
   - **inventory log 생성 (음수값으로 감소 기록)**
   - batchSizeKg만큼 감소 (고정값)

---

## 3. beanInventoryApi.create가 DB에 저장하는 방식

**파일**: `src/entities/bean-inventory/api.ts` (21-25번 라인)
```typescript
create: async (log: BeanInventoryLogInsert): Promise<BeanInventoryLog> => {
    const { data, error } = await supabase
        .from('bean_inventory_logs')
        .insert(log)
        .select()
        .single();
    if (error) throw error;
    return data!;
}
```

**저장 처리**:
- Supabase의 `bean_inventory_logs` 테이블에 **직접 INSERT**
- `BeanInventoryLogInsert` 타입:
  ```
  bean_id: string
  change_grams: number  (양수 또는 음수)
  type: 'purchase' | 'roast' | 'adjustment' | 'waste'
  user_id: string
  roast_session_id?: string | null
  note?: string | null
  created_at?: string (자동 생성)
  id?: string (자동 생성)
  ```

---

## 4. 생두 재고 계산 로직

### 계산 구조
**beans 테이블**: `stock_grams` (단순 숫자 필드)
**bean_inventory_logs**: 변화 기록

### 현재 구현의 문제점

1. **stock_grams은 직접 수정만 사용** (Supabase 계산 필드 또는 trigger 없음)
   - `useAddBeanSubmit.ts` - 'edit' 탭에서만 직접 수정됨
   - `stock_grams: Math.round(parseFloat(formData.stock) * 1000) || 0`

2. **inventory_logs는 감소 기록만 남김** (조회용)
   - 'purchase': 양수값
   - 'roast': 음수값
   - 'adjustment': ±값
   - 'waste': 음수값

3. **stock_grams과 inventory_logs 불일치 위험**
   - beans 테이블의 stock_grams ≠ inventory_logs의 합계
   - 수동으로 beans.stock_grams을 수정해야 함
   - 프론트엔드에서 UI 표시 시 beans.stock_grams 사용

### 디자인 패턴
```
재고 추가 (purchase):
  1. inventory_log 생성 (change_grams: +1000)
  2. beans.stock_grams 직접 수정 필요

재고 소비 (roast):
  - 배치 로스팅만: inventory_log 생성 (change_grams: -1000)
  - 일반 로스팅: inventory_log 생성 안 함
  - beans.stock_grams은 수정 안 함
```

---

## 5. 의도적 설계 vs 버그 판단

### 의도적 설계인 증거
- planBatchHandoff는 "계획된 배치"를 의미
- 계획되지 않은 임시 로스팅(일반 로스팅)은 재고 추적 없음
- 레시피 개발이나 테스트 로스팅과 실제 재고 로스팅 구분

### 버그인 증거
1. UI 상일반 로스팅과 배치 로스팅 구분이 명확하지 않음
2. roast_sessions 테이블에 bean_id를 저장하지만 재고는 감소 안 함
3. 사용자가 의도적으로 일반 로스팅을 선택했는지 알 수 없음
4. 'restock' 탭에서만 inventory_log 생성 (다른 곳에서는 beans.stock_grams 직접 수정)
5. beans 테이블 구조에 'total_stock' 등 계산 필드 없음

---

## 권장사항

### 즉시 확인 필요
1. **일반 로스팅 시 재고 감소가 정상인지 요구사항 확인**
   - 계획 없는 테스트 로스팅은 재고 추적하지 않는 게 맞는지?
   - 모든 로스팅이 재고 감소해야 하는지?

2. **beans.stock_grams 계산 로직 명확화**
   - inventory_logs 합계로 자동 계산?
   - 수동 관리?
   - Supabase computed column 추가?

### 개선 방향
1. ActiveRoast.tsx의 planBatchHandoff 조건 완화
   - `if (selectedBeanId && /* batchSizeKg 없이 */ user) {}`
   - 일반 로스팅도 선택된 빈의 실제 무게 입력받아 감소

2. beans 테이블에 computed field 추가
   - `stock_grams = initial_stock + SUM(inventory_logs.change_grams)`
   - 또는 RLS policy에서 조인 계산

3. 'edit' 탭 재설계
   - 직접 stock_grams 수정이 아닌 adjustment log 생성
