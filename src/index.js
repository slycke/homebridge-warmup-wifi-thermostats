// This platform integrates warmup4ie into homebridge
// As I only own single thermostat, so this only works with one, but it is
// conceivable to handle mulitple with additional coding.
//

/*jslint node: true */
'use strict';

var debug = require('debug')('warmup4ie');
var Service, Characteristic, FakeGatoHistoryService, CustomCharacteristics;
var os = require("os");
var hostname = os.hostname();
const Warmup4ie = require('./lib/warmup4ie').Warmup4IE;
const moment = require('moment');
var homebridgeLib = require('homebridge-lib');

var myAccessories = [];
var storage, thermostats;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  //  CustomCharacteristics = new homebridgeLib.EveHomeKitTypes(homebridge).Characteristics;
  //  FakeGatoHistoryService = require('fakegato-history')(homebridge);

  homebridge.registerPlatform("homebridge-warmup4ie", "warmup4ie", warmup4iePlatform);
};

function warmup4iePlatform(log, config, api) {
  this.username = config['username'];
  this.password = config['password'];
  this.refresh = config['refresh'] || 60; // Update every minute
  this.duration = config['duration'] || 60; // duration in minutes
  this.log = log;
  storage = config['storage'] || "fs";
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

warmup4iePlatform.prototype = {
  accessories: function (callback) {
    this.log("Logging into warmup4ie...");
    console.log("Rooms", this);
    thermostats = new Warmup4ie(this, function (err, rooms) {
      if (err || !rooms || !rooms.length) {
        this.log("Error loading warmup4ie rooms:", err || "No rooms returned from API");
        return callback([]);
      }
      this.log("Found %s room(s)", rooms.length);
      rooms.forEach(function (room) {
        const roomData = thermostats.room[room.roomId];
        if (roomData) {
          var newAccessory = new Warmup4ieAccessory(this, room.roomName, roomData);
          myAccessories.push(newAccessory);
        }
      }.bind(this));
      /// setInterval(pollDevices.bind(this), this.refresh * 1000);
      // DEBUG shorter periods
      setInterval(pollDevices.bind(this), 2000);
      callback(myAccessories);
    }.bind(this));
  }
};

function pollDevices() {
  myAccessories.forEach(function(acc) {
    // Try to find fresh room data based on acc.room.roomId or acc.roomId
    var freshRoom = thermostats.room[acc.room.roomId] || thermostats.room[acc.roomId];
    if (!freshRoom) {
      console.log("[DEBUG] pollDevices: No fresh room data found for accessory", acc.name);
      return;
    }
    updateStatus(freshRoom);
  });
}

function getAccessory(accessories, roomId) {
  var value;
  accessories.forEach(function (accessory) {
    // console.log("Room", accessory.room.roomId, roomId);
    if (accessory.room.roomId === roomId) {
      value = accessory;
    }
  });
  return value;
}

function updateStatus(room) {
  const acc = getAccessory(myAccessories, room.roomId);
  if (!acc || !acc.thermostatService) {
    console.log("[DEBUG] updateStatus: Missing accessory or thermostatService for room id", room.roomId);
    return;
  }
  
  const service = acc.thermostatService;

  console.log("[DEBUG] updateStatus for room:", room.roomName);
  console.log("[DEBUG] API values → locMode:", room.locMode, ", roomMode:", room.roomMode, ", runMode:", room.runMode);
  console.log("[DEBUG] Temperature values → targetTemp:", room.targetTemp, ", currentTemp:", room.currentTemp, ", airTemp:", room.airTemp);
  
  // Handle unexpected states
  if (!room.runMode || !room.roomMode) {
    console.warn("[WARN] Unexpected room state: Missing runMode or roomMode. Defaulting to OFF.");
    service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(0); // OFF
    service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(0); // OFF
    return;
  }

  // Track override locally if applicable
  if (room.runMode === "override") {
    acc.room.overrideTemp = room.overrideTemp;
    acc.room.overrideDur = room.overrideDur;
    console.log("[DEBUG] Updating accessory local state with API override data:", {
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
  console.log("[DEBUG] Updated TargetTemperature →", displayTarget);
  
  // Map the API mode to HomeKit target state.
  const hkTargetState = mapRoomToHomeKit(room);
  console.log("[DEBUG] Mapped HomeKit TargetHeatingCoolingState =", hkTargetState);
  service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(hkTargetState);
  
  // For current state, use 0 for Off, otherwise 1 (heating).
  const hkCurrentState = (hkTargetState === 0) ? 0 : 1;
  service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(hkCurrentState);
  console.log("[DEBUG] Updated CurrentHeatingCoolingState →", hkCurrentState);
  
  // Update the separate air temperature sensor.
  if (acc.temperatureService) {
    acc.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
      .updateValue(Number(room.airTemp / 10));
    console.log("[DEBUG] Updated air temperature sensor →", Number(room.airTemp / 10));
  }
}

// give this function all the parameters needed
function Warmup4ieAccessory(that, name, room) {
  this.log = that.log;
  this.log("Adding warmup4ie Device", name);
  this.name = name;
  this.username = that.username;
  this.password = that.password;
  this.room = room;
  //  this.log_event_counter = 0;
  this.roomId = room.roomId;
}

Warmup4ieAccessory.prototype = {

  setTargetHeatingCooling: function (value, callback) {
    console.log("Setting system switch for", this.name, "to", value);
    console.log("[DEBUG] setTargetHeatingCooling for", this.name, "value =", value);
    // value: 0 = Off, 1 = Heat, 2 = Cool (treated as Heat), 3 = Auto.
    switch (value) {
      case 0: // HomeKit Off → set thermostat to frost protection (OFF)
        thermostats.setLocationToOff(this.roomId, (err, json) => {
          if (err) return callback(err);
          console.log("[DEBUG] setLocationToOff response:", json);
          callback(null);
        });
        break;
      case 1: // HomeKit Heat (or COOL by mistake)
      case 2:
        // Switch the thermostat into permanent fixed mode without changing the target.
        thermostats.setTemperatureToManual(this.roomId, (err, json) => {
          if (err) return callback(err);
          console.log("[DEBUG] setTemperatureToManual response:", json);
          callback(null);
        });
        break;
      case 3: // HomeKit Auto → set thermostat to programmed/scheduled mode.
        thermostats.setTemperatureToAuto(this.roomId, (err, json) => {
          if (err) return callback(err);
          console.log("[DEBUG] setRoomAuto response:", json);
          callback(null);
        });
        break;
      default:
        callback(null);
        break;
    }
  },

  setTargetTemperature: function (value, callback) {
    // console.log("[DEBUG] Full room state at setTargetTemperature execution:", JSON.stringify(this.room, null, 2));
  
    // Synchronize the state with the API
    thermostats.getStatus((err, rooms) => {
      if (err) {
        console.error("[ERROR] Failed to synchronize room state:", err);
        return callback(err);
      }
  
      // Find the latest state for this room
      const updatedRoom = rooms.find((r) => r.roomId === this.roomId);
      if (!updatedRoom) {
        console.error("[ERROR] Room not found in updated state.");
        return callback(new Error("Room not found in updated state."));
      }
  
      // Update local state
      this.room = updatedRoom;
      // console.log("[DEBUG] Synchronized room state:", JSON.stringify(this.room, null, 2));
  
      // Apply the logic
      this._applyTargetTemperatureLogic(value, callback);
    });
  },

  _applyTargetTemperatureLogic: function (value, callback) {
    console.log(`[DEBUG] Setting target temperature for ${this.name} to ${value}°`);
    console.log(`[DEBUG] Current State → locMode: ${this.room.locMode}, roomMode: ${this.room.roomMode}, runMode: ${this.room.runMode}`);
  
    if (this.room.roomMode === "program" && (this.room.runMode === "schedule" || this.room.runMode === "override")) {
      // AUTO or OVERRIDE → Set an override
      thermostats.setOverride(this.roomId, value, (err, json) => {
        if (err) {
          console.error("[ERROR] Failed to set override in AUTO mode:", err);
          return callback(err);
        }
        console.log("[DEBUG] Override temperature set in AUTO mode:", json);
        callback(null);
      });
    } else if (this.room.roomMode === "fixed" && this.room.runMode === "fixed") {
      // FIXED → Update the fixed temperature
      thermostats.setNewTemperature(this.roomId, value, (err, json) => {
        if (err) {
          console.error("[ERROR] Failed to update fixed temperature:", err);
          return callback(err);
        }
        console.log("[DEBUG] Fixed temperature updated:", json);
        callback(null);
      });
    } else {
      // Fallback for unexpected states
      console.warn("[WARN] Unhandled state for target temperature. Defaulting to override.");
      thermostats.setOverride(this.roomId, value, (err, json) => {
        if (err) {
          console.error("[ERROR] Fallback failed to set override:", err);
          return callback(err);
        }
        console.log("[DEBUG] Fallback: Override temperature set:", json);
        callback(null);
      });
    }
  },

  getServices: function () {
    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, "warmup4ie")
      .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + this.name)
      .setCharacteristic(Characteristic.FirmwareRevision, require('../package.json').version);
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
