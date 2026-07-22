-- Add ambient temperature and humidity fields to roast_sessions

alter table roast_sessions
add column ambient_temp_celsius numeric(5,1),
add column ambient_humidity_pct numeric(4,1);
