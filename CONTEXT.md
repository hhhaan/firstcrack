# Roast language

Ubiquitous language for a roast session: what the probes report, the phase marks, the operator controls, and the replay terms. Read this before naming temperatures, phases, controls, or replay behavior.

## Measurement

**Probe measurement**:
A temperature value reported by the connected roaster or probe, expressed in physical units. It is the application's measurement source before application smoothing; it does not mean unconverted PLC bytes or a direct measurement of every bean's internal temperature.
_Avoid_: Display temperature as a synonym for measurement source.

**Displayed roast curve**:
The temperature and RoR curve presented to the operator after the selected processing. It describes the operator's view of a roast and can differ from the probe measurement series.
_Avoid_: Raw curve when the series has been smoothed.

**Drop mark**:
A record of the batch's discharge boundary, marked by the operator or estimated by automatic detection. A temperature-derived mark is an estimate of discharge and does not directly observe the discharge door.
_Avoid_: Detection callback time as a synonym for discharge time.

**Heat feedback**:
The heating value reported by the machine. It is distinct from a command issued by the application.
_Avoid_: Heat set.

**Heat set**:
A heating command applied by the application. A Replay plan reproduces these commands using its reference temperature or time cues. The operator-facing name for that power is Gas.
_Avoid_: Measured heating power as a replacement for recorded commands.

## Temperatures

**BT**:
Bean temperature (빈 온도). The probe inside the drum.
_Avoid_: Exhaust or inlet temperature.

**ET**:
Exhaust temperature (배기 온도). The probe in the exhaust path.
_Avoid_: Bean temperature.

**IT**:
Inlet temperature (입구 온도). Used mainly on air roasters.
_Avoid_: Bean temperature, exhaust temperature.

**RoR**:
Rate of rise (온도 상승 속도), in °C/min, over a 30-second or 1-minute window. Its meaning depends on the temperature channel and the processing applied to that series.
_Avoid_: A second temperature measurement.

## Phases

**Charge**:
투입. The moment beans enter the drum.
_Avoid_: The wait before that moment.

**TP**:
Turning point (최저점). BT has bottomed and starts rising again.
_Avoid_: Charge, drop.

**Dry end**:
건조 종료. Around 150°C.
_Avoid_: Yellowing.

**Yellowing**:
The moment the beans turn yellow.
_Avoid_: Dry end, Maillard.

**Maillard**:
마이야르 반응. The span where browning and flavor develop.
_Avoid_: The yellowing mark itself. The drying span before yellowing.

**FC**:
First crack (1차 크랙). The beans pop and make a sound.
_Avoid_: Second crack.

**SC**:
Second crack (2차 크랙).
_Avoid_: First crack.

**Drop**:
배출. Roasting ends and the beans leave the drum.
_Avoid_: The cooling that follows. Cooling is a different track.

## Controls

**Gas**:
화력, in percent. The operator name for heat power. The application command is Heat set.
_Avoid_: Heat feedback. Airflow.

**Airflow**:
배기 팬 세기.
_Avoid_: Damper. Gas.

**Drum speed**:
드럼 회전 속도.
_Avoid_: Airflow.

**Damper**:
배기 통로 개도.
_Avoid_: Airflow. The fan strength and the exhaust-path opening are different controls.

## Control

**PID**:
비례·적분·미분 제어. Adjusts automatically from the error between target and actual.
_Avoid_: A manual gas step.

**PV**:
Process value. The measured actual.
_Avoid_: Set value.

**SV**:
Set value. The target.
_Avoid_: Process value.

**Lookahead**:
Control from a target ahead of now, to offset probe lag.
_Avoid_: Correcting only the current error.

**Feedforward**:
A correction applied before an error appears.
_Avoid_: Feedback.

**Feedback**:
A correction applied after an error appears.
_Avoid_: Feedforward.

## Software

**Reference roast**:
재현할 대상 프로파일.
_Avoid_: The live batch. The account profile.

**Replay assist**:
기준 로스팅을 자동 재현하는 기능.
_Avoid_: A manual gas change.

**Event mapping**:
가스 변경을 온도에 묶어 두는 방식.
_Avoid_: A time-only gas list when the binding is temperature.

**Gas replay**:
기준 로스팅의 가스 커브 재생.
_Avoid_: Replaying bean temperature as if it were the gas command.

## Quality

**Development time**:
1차 크랙 이후 배출까지의 시간.
_Avoid_: The whole roast duration. The Maillard span.
