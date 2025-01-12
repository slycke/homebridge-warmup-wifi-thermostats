# homebridge-warmup4ie

Homebridge plugin for the WarmUP 4iE thermostat.

Plugin works with program mode only, and changes to the temperature are treated as an override.  Fixed temperature mode is not supported.  

# Table of Contents

<!--ts-->
   * [homebridge-warmup4ie](#homebridge-warmup4ie)
   * [Table of Contents](#table-of-contents)
   * [Using the plugin](#using-the-plugin)
      * [Temperature Control](#temperature-control)
      * [Mode Setting](#mode-setting)
   * [Settings](#settings)
      * [Required settings](#required-settings)
      * [Optional settings](#optional-settings)

<!-- Added by: sgracey, at:  -->

<!--te-->

# Using the plugin

Thermostats are retrieved from the my.warmup.com site, and are automatically created in the Home App.

## Temperature Control

Changes to the temperature create a temperature override for the current setting.  Length of the override defaults to 60 Minutes ( or the duration setting).  

## Mode Setting

`Off` - Turns off the thermostat
`Heat` - Turns on the thermostat and resumes current program
`Auto` - Turns on the thermostat and resumes current program

When the thermostat is in temperature override mode, the Mode setting is set to `Heat`.  To clear the override and resume program mode, turn the mode control to `Auto`.

# Settings

```
"platforms": [{
  "platform": "warmup4ie",
  "name": "WarmUP",
  "username": "XXXXXXXXXXXX",
  "password": "XXXXXXXXXXXX"
}]
```

## Required settings

* `username` - Your My.Warmup.com email address / login
* `password` - Your My.Warmup.com password

## Optional settings

* `refresh` - Data polling interval in seconds, defaults to 60 seconds
* `storage` - Storage of chart graphing data for history graphing, either fs or googleDrive, defaults to fs
* `duration` - Duration of temperature override, defaults to 60 minutes

# Change log

NOT possible to set to OFF

Warmup API:
OFF: Thermostat off. System set to always protect against frost.
   "locMode": "frost",
   "roomMode": "fixed",
   "runMode": "anti_frost",
==> HomeKit should show OFF. If HomeKit is set to OFF, the thermostat needs to be set to these values.

AUTO: Thermostat set to run its program automatically. System set to always protect against frost.
   "roomMode": “program”
   "runMode": “schedule”
==> HomeKit should show "AUTO". If HomeKit is set to AUTO the thermostate should be set to these values.

OVERRIDE: Thermostat set to run its program automatically, but with a temporary override for a certain duration. System set to always protect against frost.
   "locMode": "frost",
   "roomMode": "program",
   "runMode": "override",
   "targetTemp": 180,
   "overrideTemp": 180,
   "overrideDur": 110,
==> HomeKit can not directly set this mode (program with override), but instead it will be used whenever a user sets
a temperature setpoint (targetTemperature) but the system is in program mode. Temperature will then be modified for
a certain period (duration setting) and then the thermostat will return to its program.

Also possible:
"roomMode": "fixed",
"runMode": "override",

FIXED: Thermostat set a fixed temperature. System set to always protect against frost.
   "locMode": "frost",
   "roomMode": "fixed",
   "runMode": "fixed",
==> HomeKit should show "HEAT". If HomeKit is set to HEAT the thermostate should be set to these values.
If we can not remove "COOL" from HomeKit accessory then if set to COOL it should also be set to these values.

Next to all this we have the currentTemp and targetTemp. These temperature setpoints are very important ofcourse
for the thermostat but should never ever be used to change the mode. Not the roomMode and not the runMode.
They are just setpoints for the thermostat!

When setting a new temperature setpoint from HomeKit we use the following:
* If thermostat is OFF/FROST and a new targetTemperature is set, then swith the thermostat to AUTO and set the temperature setpoint as an OVERRIDE for the configured Duration.
* If thermostat is AUTO and a new targetTemperature is set, then keep the thermostat in AUTO and set the temperature setpoint as an OVERRIDE for the configured Duration.
* If thermostat is in OVERRIDE and a new targetTemperature is set, then keep the thermostat in AUTO and set the temperature setpoint as a (new) OVERRIDE for the configured Duration.
* If thermostat is in FIXED and a new targetTemperature is set, then keep the thermostat in FIXED and set the temperature setpoint as a (new) targetTemperature.


	•	HomeKit Off (0) → Warmup “frost” (i.e. completely “off” so heating won’t trigger)
	•	HomeKit Auto (3) → Warmup “prog” (program mode, schedule)
	•	HomeKit Heat (1) (or Cool (2), which we treat as Heat) →
 • If the current run mode is “prog”, switch to “overide” (temporary manual change)
 • If it’s already “fixed”, remain fixed
 • Otherwise (if already override or anything else), force override


	•	HomeKit only supports these standard modes:
	•	0 = Off
	•	1 = Heat
	•	2 = Cool
	•	3 = Auto
	•	Warmup has these modes:
	•	"off"
	•	"override"
	•	"fixed"
	•	"schedule" (sometimes "program")

	1.	Map HomeKit “Off” → Warmup off
	2.	Map HomeKit “Auto” → Warmup prog (schedule)
	3.	Map HomeKit “Heat” →
	•	If thermostat is already in fixed, stay in fixed (apply new setpoint permanently).
	•	If thermostat is in program, switch to override (temporary mode, with a duration).
	•	If thermostat is in override, remain in override.
	•	If thermostat is in off, you can choose either fixed or override (your call).

This logic ensures:
	•	Changing temperature while in program puts it in a temporary override (resuming program eventually).
	•	Changing temperature in fixed keeps it permanent.
	•	“Off” truly shuts everything down.
	1.	Map HomeKit “Off” → Warmup off
	2.	Map HomeKit “Auto” → Warmup prog (schedule)
	3.	Map HomeKit “Heat” →
	•	If thermostat is already in fixed, stay in fixed (apply new setpoint permanently).
	•	If thermostat is in program, switch to override (temporary mode, with a duration).
	•	If thermostat is in override, remain in override.
	•	If thermostat is in off, set temperature setpoint as override.