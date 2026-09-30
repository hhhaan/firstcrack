# Roast measurement language

Terms for distinguishing what the roaster reports, what the operator sees, and what a roast event means.

## Language

**Probe measurement**:
A temperature value reported by the connected roaster or probe, expressed in physical units. It is the application's measurement source before application smoothing; it does not mean unconverted PLC bytes or a direct measurement of every bean's internal temperature.
_Avoid_: Display temperature as a synonym for measurement source.

**Displayed roast curve**:
The temperature and RoR curve presented to the operator after the selected processing. It describes the operator's view of a roast and can differ from the probe measurement series.
_Avoid_: Raw curve when the series has been smoothed.

**RoR**:
The rate of change of a roast temperature series, expressed per minute. Its meaning depends on the temperature channel, time intervals, and processing used.
_Avoid_: A second temperature measurement.

**Drop mark**:
A record of the batch's discharge boundary, marked by the operator or estimated by automatic detection. A temperature-derived mark is an estimate of discharge and does not directly observe the discharge door.
_Avoid_: Detection callback time as a synonym for discharge time.

**Heat feedback**:
The heating value reported by the machine. It is distinct from a command issued by the application.
_Avoid_: Heat set.

**Heat set**:
A heating command applied by the application. A Replay plan reproduces these commands using its reference temperature or time cues.
_Avoid_: Measured heating power as a replacement for recorded commands.
