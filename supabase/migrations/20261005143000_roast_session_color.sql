-- Optional whole-bean / ground roast color. Manual entry, no meter.
-- History updates these columns directly. save_roast_op does not write them yet.
alter table public.roast_sessions
    add column if not exists color_whole numeric
        check (color_whole is null or color_whole >= 0),
    add column if not exists color_ground numeric
        check (color_ground is null or color_ground >= 0);

comment on column public.roast_sessions.color_whole is '홀빈 색도. 수동 입력, 계측기 없음. null이면 미기록';
comment on column public.roast_sessions.color_ground is '분쇄 색도. 수동 입력, 계측기 없음. null이면 미기록';
