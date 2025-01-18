// This platform integrates Warmup Smart Wifi Thermostats into Homebridge
// This should work with the 6iE, 4iE and Element Smart Thermostats
// This plugin is also tested to work with multiple thermostats.
import os from 'os';
// import moment from 'moment'; 
// import homebridgeLib from 'homebridge-lib';
import { WarmupThermostats } from './lib/warmup.js';

let Service, Characteristic;
//let CustomCharacteristics;

const hostname = os.hostname();
let myAccessories = [];
let thermostats;

export default (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerPlatform(
    "homebridge-warmup-wifi-thermostats",
    "warmup-wifi-thermostats",
    warmupWiFiThermostatsPlatform
  );
};

function warmupWiFiThermostatsPlatform(log, config, api) {
  this.username = config['username'];
  this.password = config['password'];
  this.refresh = config['refresh'] || 60; // Update every minute
  this.duration = config['duration'] || 60; // duration in minutes
  this.log = log;
}

function mapRoomToHomeKit(room) {
  // OFF: Entire system or specific room is off (anti_frost or off mode)
  if (room.locMode === "off" || room.runMode === "anti_frost") {
    return 0; // OFF
  }
  // AUTO: Program mode (schedule) or a temporary override
  if (room.roomMode === "program" && (room.runMode === "schedule" || room.runMode === "override")) {
    return 3; // AUTO
  }
  // FIXED: Manual mode with a permanent setpoint
  if (room.roomMode === "fixed" && room.runMode === "fixed") {
    return 1; // HEAT
  }
  // Default fallback to HEAT
  return 1;
}

warmupWiFiThermostatsPlatform.prototype = {
  accessories: function (callback) {
    this.log.info("Logging into Warmup API...");
    this.log.debug("Rooms", this);
    thermostats = new WarmupThermostats(this, function (err, rooms) {
      if (err || !rooms || !rooms.length) {
        this.log.error("Error loading Warmup Thermostat rooms:", err || "No rooms returned from API");
        return callback([]);
      }
      this.log.info("Found %s room(s)", rooms.length);
      rooms.forEach((room) => {
        const roomData = thermostats.room[room.roomId];
        if (roomData) {
          var newAccessory = new WarmupThermostatAccessory(this, room.roomName, roomData);
          myAccessories.push(newAccessory);
        }
      });
      setInterval(this.pollDevices.bind(this), this.refresh * 1000);
      // DEBUG shorter periods
      // setInterval(this.pollDevices.bind(this), 2000);
      callback(myAccessories);
    }.bind(this));
  },

  pollDevices: function () {
    myAccessories.forEach((acc) => {
      // Try to find fresh room data based on acc.room.roomId or acc.roomId
      const freshRoom = thermostats.room[acc.room.roomId] || thermostats.room[acc.roomId];
      if (!freshRoom) {
        this.log.debug("[DEBUG] pollDevices: No fresh room data found for accessory", acc.name);
        return;
      }
      this.updateStatus(freshRoom);
    });
  },

  updateStatus: function (room) {
    const acc = getAccessory(myAccessories, room.roomId);
    if (!acc || !acc.thermostatService) {
      this.log.debug("[DEBUG] updateStatus: Missing accessory or thermostatService for room id", room.roomId);
      return;
    }

    const service = acc.thermostatService;

    this.log.debug("[DEBUG] updateStatus for room:", room.roomName);
    this.log.debug("[DEBUG] API values → locMode:", room.locMode, ", roomMode:", room.roomMode, ", runMode:", room.runMode);
    this.log.debug("[DEBUG] Temperature values → targetTemp:", room.targetTemp, ", currentTemp:", room.currentTemp, ", airTemp:", room.airTemp);

    // Handle unexpected states
    if (!room.runMode || !room.roomMode) {
      this.log.warn("[WARN] Unexpected room state: Missing runMode or roomMode. Defaulting to OFF.");
      service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(0); // OFF
      service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(0); // OFF
      return;
    }

    // Track override locally if applicable
    if (room.runMode === "override") {
      acc.room.overrideTemp = room.overrideTemp;
      acc.room.overrideDur = room.overrideDur;
      this.log.debug("[DEBUG] Updating accessory local state with API override data:", {
        overrideTemp: room.overrideTemp,
        overrideDur: room.overrideDur,
      });
    }

    // Update temperature characteristics
    // Update the current temperature first.
    service.getCharacteristic(Characteristic.CurrentTemperature)
      .updateValue(Number(room.currentTemp / 10));

    // Determine TargetTemperature
    let displayTarget = (room.runMode === "override")
      ? Number(room.overrideTemp / 10)
      : Number(room.targetTemp / 10);

    service.getCharacteristic(Characteristic.TargetTemperature)
      .updateValue(displayTarget);
    this.log.info(`Room "${room.roomName}": Updated TargetTemperature → ${displayTarget}`);

    // Map the API mode to HomeKit target state.
    const hkTargetState = mapRoomToHomeKit(room);
    this.log.debug("[DEBUG] Mapped HomeKit TargetHeatingCoolingState =", hkTargetState);
    service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(hkTargetState);

    // For current state, use 0 for Off, otherwise 1 (heating).
    const hkCurrentState = (hkTargetState === 0) ? 0 : 1;
    service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(hkCurrentState);
    this.log.debug("[DEBUG] Updated CurrentHeatingCoolingState →", hkCurrentState);

    // Update the separate air temperature sensor.
    if (acc.temperatureService) {
      acc.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
        .updateValue(Number(room.airTemp / 10));
      this.log.debug("[DEBUG] Updated air temperature sensor →", Number(room.airTemp / 10));
    }
  }
}

function getAccessory(accessories, roomId) {
  var value;
  accessories.forEach((accessory) => {
    // this.log.debug("Room", accessory.room.roomId, roomId);
    if (accessory.room.roomId === roomId) {
      value = accessory;
    }
  });
  return value;
}

// give this function all the parameters needed
function WarmupThermostatAccessory(that, name, room) {
  this.log = that.log;
  this.log.info("Adding Warmup Wifi Thermostat Device", name);
  this.name = name;
  this.username = that.username;
  this.password = that.password;
  this.room = room;
  //  this.log_event_counter = 0;
  this.roomId = room.roomId;
}

WarmupThermostatAccessory.prototype = {

  setTargetHeatingCooling: function (value, callback) {
    this.log.debug("Setting system switch for", this.name, "to", value);
    this.log.debug("[DEBUG] setTargetHeatingCooling for", this.name, "value =", value);
    // value: 0 = Off, 1 = Heat, 2 = Cool (treated as Heat), 3 = Auto.
    switch (value) {
      case 0: // HomeKit Off → set thermostat to frost protection (OFF)
        thermostats.setLocationToOff(this.roomId, (err, json) => {
          if (err) return callback(err);
          this.log.debug("[DEBUG] setLocationToOff response:", json);
          callback(null);
        });
        break;
      case 1: // HomeKit Heat (or COOL by mistake)
      case 2:
        // Switch the thermostat into permanent fixed mode without changing the target.
        thermostats.setTemperatureToManual(this.roomId, (err, json) => {
          if (err) return callback(err);
          this.log.debug("[DEBUG] setTemperatureToManual response:", json);
          callback(null);
        });
        break;
      case 3: // HomeKit Auto → set thermostat to programmed/scheduled mode.
        thermostats.setTemperatureToAuto(this.roomId, (err, json) => {
          if (err) return callback(err);
          this.log.debug("[DEBUG] setRoomAuto response:", json);
          callback(null);
        });
        break;
      default:
        callback(null);
        break;
    }
  },

  setTargetTemperature: function (value, callback) {
    // this.log.debug("[DEBUG] Full room state at setTargetTemperature execution:", JSON.stringify(this.room, null, 2));

    // Synchronize the state with the API
    thermostats.getStatus((err, rooms) => {
      if (err) {
        this.log.error("[ERROR] Failed to synchronize room state:", err);
        return callback(err);
      }

      // Find the latest state for this room
      const updatedRoom = rooms.find((r) => r.roomId === this.roomId);
      if (!updatedRoom) {
        this.log.error("[ERROR] Room not found in updated state.");
        return callback(new Error("Room not found in updated state."));
      }

      // Update local state
      this.room = updatedRoom;
      // this.log.debug("[DEBUG] Synchronized room state:", JSON.stringify(this.room, null, 2));

      // Apply the logic
      this._applyTargetTemperatureLogic(value, callback);
    });
  },

  _applyTargetTemperatureLogic: function (value, callback) {
    this.log.debug(`[DEBUG] Setting target temperature for ${this.name} to ${value}°`);
    this.log.debug(`[DEBUG] Current State → locMode: ${this.room.locMode}, roomMode: ${this.room.roomMode}, runMode: ${this.room.runMode}`);

    if (this.room.roomMode === "program" && (this.room.runMode === "schedule" || this.room.runMode === "override")) {
      // AUTO or OVERRIDE → Set an override
      thermostats.setOverride(this.roomId, value, (err, json) => {
        if (err) {
          this.log.error("[ERROR] Failed to set override in AUTO mode:", err);
          return callback(err);
        }
        this.log.debug("[DEBUG] Override temperature set in AUTO mode:", json);
        callback(null);
      });
    } else if (this.room.roomMode === "fixed" && this.room.runMode === "fixed") {
      // FIXED → Update the fixed temperature
      thermostats.setNewTemperature(this.roomId, value, (err, json) => {
        if (err) {
          this.log.error("[ERROR] Failed to update fixed temperature:", err);
          return callback(err);
        }
        this.log.debug("[DEBUG] Fixed temperature updated:", json);
        callback(null);
      });
    } else {
      // Fallback for unexpected states
      this.log.warn("[WARN] Unhandled state for target temperature. Defaulting to override.");
      thermostats.setOverride(this.roomId, value, (err, json) => {
        if (err) {
          this.log.error("[ERROR] Fallback failed to set override:", err);
          return callback(err);
        }
        this.log.debug("[DEBUG] Fallback: Override temperature set:", json);
        callback(null);
      });
    }
  },

  getServices: function () {
    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, "warmup-wifi-thermostats")
      .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + this.name)
    //  .setCharacteristic(Characteristic.FirmwareRevision, require('../package.json').version);
    // Thermostat Service
    //
    this.temperatureService = new Service.TemperatureSensor(this.name + " Air");
    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100
      });
    this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
      .updateValue(Number(this.room.airTemp / 10));

    this.thermostatService = new Service.Thermostat(this.name);
    this.thermostatService.isPrimaryService = true;

    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [0, 1, 3]
      });

    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('set', this.setTargetHeatingCooling.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .on('set', this.setTargetTemperature.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
        minValue: this.room.minTemp / 10,
        maxValue: this.room.maxTemp / 10
      });

    this.thermostatService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100
      });

    var targetTemperature = (this.room.targetTemp > this.room.minTemp ? this.room.targetTemp : this.room.minTemp);
    this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
      .updateValue(Number(targetTemperature / 10));

    this.thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
      .updateValue(Number(this.room.currentTemp / 10));

    var currentHeatingCoolingState;
    switch (this.room.runMode) {
      case "off":
        currentHeatingCoolingState = 0;
        break;
      default:
      case "fixed": // Heat
      case "override": // Heat
      case "schedule":
        if (this.room.currentTemp < this.room.targetTemp) {
          currentHeatingCoolingState = 1;
        } else {
          currentHeatingCoolingState = 0;
        }
        break;
    }

    this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .updateValue(currentHeatingCoolingState);

    var targetHeatingCoolingState;
    switch (this.room.runMode) {
      case "off":
        targetHeatingCoolingState = 0;
        break;
      default:
      case "fixed": // Heat
      case "override": // Heat
        targetHeatingCoolingState = 1;
        break;
      case "schedule":
        targetHeatingCoolingState = 1;
        break;
    }

    this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .updateValue(targetHeatingCoolingState);

    return [informationService, this.thermostatService, this.temperatureService];
  }
};
