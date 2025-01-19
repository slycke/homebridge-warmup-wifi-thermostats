# homebridge-warmup-wifi-thermostats

Homebridge plugin for the Warmup Smart Wifi Thermostats 6iE, 4iE and Element. The plugin supports multiple thermostats/rooms if they are configured in your Warmup account.

*Note: forked from [NorthernMan54/homebridge-warmup4ie](https://github.com/NorthernMan54/homebridge-warmup4ie) and inspiration from the [HomeAssistant warmup4ie plugin](https://github.com/alex-0103/warmup4IE/tree/dev)*

# Using the plugin
You need to enter your Warum account credentials in the configuration of the plugin.

Thermostats are retrieved from the https://my.warmup.com site, and are automatically created in HomeKit.

## Dynamic programming based on Energy Price
Idea: use Apple HomeKit Automations to dynamically control the temperature setpoints of the Warmup Smart Wifi Thermostats based on Energy Price. This is easy using e.g. the European EPEX pricing in Homebridge: https://github.com/slycke/homebridge-epex

## Temperature Control

If the thermostat is in Program mode, changes to the temperature create a temperature override for the current setting. The duration of the override defaults to 60 Minutes (or the duration setting that you have configured).  

If the thermostat is in Fixed temperature mode, changes to the temperature set a new Fixed teperature.

# Known Issues

1. Setting mode to 'OFF' does not work yet. The API throws a "130" error.

## Mode Settings
* `Off` - not yet supported.
* `Heat` - Set a Fixed temperature on the thermostat to the value that you set in the Home app.
* `Cool` - not supported, is mapped to `Heat` (which is a Fixed target temperature)
* `Auto` - Enable the Program mode on the thermostat.
* `Set temperature`
  * If the thermostat is in Fixed mode it will set a new target temperature in Fixed mode.
  * If the thermostat is in Program mode it will create a temporary Override for a set Duration (configurable). When the Override is complete the Program will be resumed.

# Settings

## Required settings
* `username` - Your My.Warmup.com email address / login
* `password` - Your My.Warmup.com password

## Optional settings

* `refresh` - Data polling interval in seconds, defaults to 60 seconds
* `duration` - Duration of temperature override, defaults to 60 minutes

# Changelog

## version 0.0.2
* cleanup logging and improve debug logging.
* fix a bug in HomeKit accessory initialization.
* updated README.

## version 0.0.1
* enabled support of multiple thermostats (rooms)
* enabled support of UI configuration in Homebridge
* support for default Homebridge logs
* removed `requests` dependecy and moved to `axios`
* moved to `package.json` `"type": "module"`
* removed/updated dependencies on outdated and insecure packages (e.g. `jest`)

# Warmup API interpretation and mapping to HomeKit
`OFF`: *[NOTE NOT YET SUPPORTED]* Thermostat is set to off. If system set to protect against frost.
*   "locMode": "frost",
*   "roomMode": "fixed",
*   "runMode": "anti_frost",

==> HomeKit should show OFF. If HomeKit is set to OFF, the thermostat needs to be set to these values.

`AUTO`: Thermostat is set to run its program automatically. If system set to protect against frost.
*   "roomMode": “program”
*   "runMode": “schedule”

==> HomeKit should show "AUTO". If HomeKit is set to AUTO the thermostate should be set to these values.

`HEAT` is the same as `COOL`: Thermostat is set to a fixed target temperature. That does not mean the heating/cooling will turn on. It is just the setpoint of the thermostat. If system set to protect against frost.
*   "locMode": "frost",
*   "roomMode": "fixed",
*   "runMode": "fixed",

==> HomeKit should show "HEAT". If HomeKit is set to HEAT the thermostate should be set to these values.

## Setting target temperature setpoint
`OVERRIDE`: Thermostat set to run its program automatically, but with a temporary override for a certain Duration (configurable). If system set to protect against frost.
*   "locMode": "frost",
*   "roomMode": "program",
*   "runMode": "override",
*   "targetTemp": 180,
*   "overrideTemp": 180,
*   "overrideDur": 110,

==> HomeKit can not directly set this mode (program with override), but instead it will be used whenever a user sets a temperature setpoint (targetTemperature) but the system is in program mode. Temperature will then be modified for
a certain period (Duration setting) and then the thermostat will return to its program.