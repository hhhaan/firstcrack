# 프로파일은 기준 로스트를 하나 가진다

채택. 2026-10-27.

모든 로스팅 프로파일은 기준 로스트를 정확히 하나 가진다. 기준 로스트는 그 프로파일의 곡선을 만드는 완료된 로스트다. 저장 위치는 `roast_profiles.source_session_id`다.

저장된 기준이 그 프로파일의 완료 로스트 목록에 없으면, 가장 최근 완료 로스트를 기준으로 저장한다. 완료 로스트가 없으면 새로 지정하지 않는다. 이미 목록 안에 있는 기준은 바꾸지 않는다.

이 기준은 다른 프로파일이 아니다. `CONTEXT.md`의 Reference roast(재현할 대상 프로파일)와도 다르다.

구현: `src/widgets/profile-detail/ui/ProfileReferenceBatches.tsx`.
