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
화력. The operator's heating setting, expressed in the connected roaster's control unit, commonly percent. The application command is Heat set.
_Avoid_: Heat feedback. Airflow.

**Charge gas**:
투입 화력. The gas setting in effect when beans enter the drum; it can have been established before Charge. It does not imply that a new Heat set command was issued at Charge.
_Avoid_: A command automatically issued on Charge.

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

**Profile source roast**:
기준 로스트. 로스팅 프로파일이 반드시 하나 가리키는 완료된 로스트. 프로파일 곡선은 이 로스트를 따른다. 저장된 기준이 그 프로파일의 완료 로스트에 없으면 가장 최근 완료 로스트가 기준이 된다. 완료 로스트가 없으면 새로 지정하지 않는다.
_Avoid_: Reference roast. 또 다른 프로파일.

**Recorded heat set**:
기록된 화력 명령. A Heat set retained from a reference roast, together with the elapsed time from Charge and BT at which it was recorded. Those observations describe the past command; they do not by themselves define its replay condition.
_Avoid_: Heat feedback. A future replay instruction.

**Replay plan**:
화력 재현 계획. An ordered set of Heat set instructions and their replay conditions for a batch. It is distinct from the record of the reference roast.
_Avoid_: Recorded heat set. A target temperature curve.

**Replay condition**:
화력 변경 조건. The selected criterion for applying a Heat set in a replay plan, such as elapsed time from Charge or reaching a BT on the rising side of TP.
_Avoid_: Recorded time and BT as simultaneous requirements. Elapsed time from TP as a synonym for elapsed time from Charge.

**Replay assist**:
기준 로스팅의 Heat set 명령을 시간·온도 조건에 맞춰 적용하는 운전 보조. 명령의 재현은 온도 커브나 향미 결과의 일치를 뜻하지 않는다.
_Avoid_: A manual gas change.

**Event mapping**:
기록된 화력 명령을 화력 재현 계획의 화력 변경 조건에 연결하는 것.
_Avoid_: A temperature-curve target as a synonym for a command's replay condition.

**Gas replay**:
기준 로스팅에 기록된 Heat set 명령의 재생. 기계가 보고한 Heat feedback 곡선과는 구별된다.
_Avoid_: Replaying bean temperature as if it were the gas command.

## Production

**Roast batch**: A quantity of green coffee roasted together in one physical cycle, from charge to discharge. Multiple roast batches may fulfill one production plan item.
_Avoid_: Production plan item.

**Production plan item**: Planned production of a specified coffee or blend recipe and quantity. A post-roast blend is fulfilled by roasting its components separately and blending them afterward.
_Avoid_: Roast batch.

**Between-batch protocol (BBP)**: A procedure for managing the roaster's thermal condition between one batch's discharge and the next charge. It is distinct from cooling the discharged coffee.
_Avoid_: Cooling the roasted coffee.

## Quality

**Saved-roast correction**:
An operator's correction to an already saved roast's charge weight, measured output, or roast level. Measured output takes precedence over an estimate; correcting a roast does not repeat its plan-batch stock deduction.
_Avoid_: A new roast save, a rewrite of the recorded measurement series, or a Saved-record edit.

**Saved-record edit**:
An operator's change to an already saved roast's phase marks, notes, airflow, drum speed, or recorded Heater rows and their Heat set. A review edit and a history edit are both Saved-record edits.
_Avoid_: Saved-roast correction. A new roast save. A rewrite of the probe measurement series.

**Development time**:
1차 크랙 이후 배출까지의 시간.
_Avoid_: The whole roast duration. The Maillard span.
