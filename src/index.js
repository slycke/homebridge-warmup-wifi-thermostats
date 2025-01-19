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
    'homebridge-warmup-wifi-thermostats',
    'warmup-wifi-thermostats',
    warmupWiFiThermostatsPlatform,
  );
};

function warmupWiFiThermostatsPlatform(log, config) {
  this.username = config.username;
  this.password = config.password;
  this.refresh = config.refresh || 60; // Update every minute
  this.duration = config.duration || 60; // duration in minutes
  this.log = log;
}

function mapRoomToHomeKit(room) {
  // OFF: Entire system or specific room is off (anti_frost or off mode)
  if (room.locMode === 'off' || room.runMode === 'anti_frost') {
    return 0; // OFF
  }
  // AUTO: Program mode (schedule) or a temporary override
  if (room.roomMode === 'program' && (room.runMode === 'schedule' || room.runMode === 'override')) {
    return 3; // AUTO
  }
  // FIXED: Manual mode with a permanent setpoint
  if (room.roomMode === 'fixed' && room.runMode === 'fixed') {
    return 1; // HEAT
  }
  // Default fallback to HEAT
  return 1;
}

warmupWiFiThermostatsPlatform.prototype = {
  accessories: function (callback) {
    this.log.info('Logging into Warmup API...');
    this.log.debug('Rooms', this);
    thermostats = new WarmupThermostats(this, ((err, rooms) => {
      if (err || !rooms || !rooms.length) {
        this.log.error('Error loading Warmup Thermostat rooms:', err || 'No rooms returned from API');
        return callback([]);
      }
      this.log.info('Found %s room(s)', rooms.length);
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
    }));
  },

  pollDevices: function () {
    myAccessories.forEach((acc) => {
      // Try to find fresh room data based on acc.room.roomId or acc.roomId
      const freshRoom = thermostats.room[acc.room.roomId] || thermostats.room[acc.roomId];
      if (!freshRoom) {
        this.log.debug('[DEBUG] pollDevices: No fresh room data found for accessory', acc.name);
        return;
      }
      this.updateStatus(freshRoom);
    });
  },

  updateStatus: function (room) {
    const acc = getAccessory(myAccessories, room.roomId);
    if (!acc || !acc.thermostatService) {
      this.log.debug('[DEBUG] updateStatus: Missing accessory or thermostatService for room id', room.roomId);
      return;
    }

    const service = acc.thermostatService;

    this.log.debug('[DEBUG updateStatus] For room:', room.roomName);
    this.log.debug('[DEBUG updateStatus] API values → locMode:', room.locMode, ', roomMode:', room.roomMode, ', runMode:', room.runMode);
    this.log.debug('[DEBUG updateStatus] Temperature values → targetTemp:', room.targetTemp, ', currentTemp:', room.currentTemp, ', airTemp:', room.airTemp);

    // Handle unexpected states
    if (!room.runMode || !room.roomMode) {
      this.log.warn('[WARN updateStatus] Unexpected room state: Missing runMode or roomMode. Defaulting to OFF.');
      service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(0); // OFF
      service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(0); // OFF
      return;
    }

    // Track override locally if applicable
    if (room.runMode === 'override') {
      acc.room.overrideTemp = room.overrideTemp;
      acc.room.overrideDur = room.overrideDur;
      this.log.debug('[DEBUG updateStatus] Updating accessory local state with API override data:', {
        overrideTemp: room.overrideTemp,
        overrideDur: room.overrideDur,
      });
    }

    // Update temperature characteristics
    service.getCharacteristic(Characteristic.CurrentTemperature)
      .updateValue(Number(room.currentTemp / 10));

    // Determine TargetTemperature
    let displayTarget = (room.runMode === 'override')
      ? Number(room.overrideTemp / 10)
      : Number(room.targetTemp / 10);

    // Only update if the cached target is undefined (first run) or different from displayTarget.
    if (acc.cachedTarget === undefined || acc.cachedTarget !== displayTarget) {
      service.getCharacteristic(Characteristic.TargetTemperature)
        .updateValue(displayTarget);
      this.log.info(`[updateStatus] Room "${room.roomName}": Updated TargetTemperature from ${acc.cachedTarget} to ${displayTarget}`);
      // Store the new value in the cache for future comparisons.
      acc.cachedTarget = displayTarget;
    } else {
      this.log.debug(`[DEBUG updateStatus] Room "${room.roomName}": No change in TargetTemperature. \
Previous targetTemp ${acc.cachedTarget} New targetTemp: ${displayTarget}`);
    }

    // Map the API mode to HomeKit target state.
    const hkTargetState = mapRoomToHomeKit(room);
    this.log.debug('[DEBUG updateStatus] Mapped HomeKit TargetHeatingCoolingState =', hkTargetState);
    service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(hkTargetState);

    // For current state, use 0 for Off, otherwise 1 (heating).
    const hkCurrentState = (hkTargetState === 0) ? 0 : 1;
    service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(hkCurrentState);
    this.log.debug('[DEBUG updateStatus] Updated CurrentHeatingCoolingState →', hkCurrentState);

    // Update the separate air temperature sensor.
    if (acc.temperatureService) {
      acc.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
        .updateValue(Number(room.airTemp / 10));
      this.log.debug('[DEBUG updateStatus] Updated air temperature sensor →', Number(room.airTemp / 10));
    }
  },
};

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
  this.log.info('Adding Warmup Wifi Thermostat Device', name);
  this.name = name;
  this.username = that.username;
  this.password = that.password;
  this.room = room;
  this.roomId = room.roomId;
  // Add a cachedTarget property. Initially, set it to the target temperature from the API.
  this.cachedTargetTemp = (room.runMode === 'override')
    ? Number(room.overrideTemp / 10)
    : Number(room.targetTemp / 10);
}

WarmupThermostatAccessory.prototype = {
  setTargetHeatingCooling: function (value, callback) {
    this.log.debug('[DEBUG] Setting system switch for', this.name, 'to', value);
    this.log.debug('[DEBUG] setTargetHeatingCooling for', this.name, 'value =', value);
    // value: 0 = Off, 1 = Heat, 2 = Cool (treated as Heat), 3 = Auto.
    switch (value) {
    case 0: // HomeKit Off → set thermostat to frost protection (OFF)
      thermostats.setLocationToOff(this.roomId, (err, json) => {
        if (err) {
          return callback(err);
        }
        this.log.debug('[DEBUG] setLocationToOff response:', json);
        callback(null);
      });
      break;
    case 1: // HomeKit Heat (or COOL by mistake)
    case 2:
      // Switch the thermostat into permanent fixed mode without changing the target.
      thermostats.setTemperatureToManual(this.roomId, (err, json) => {
        if (err) {
          return callback(err);
        }
        this.log.debug('[DEBUG] setTemperatureToManual response:', json);
        callback(null);
      });
      break;
    case 3: // HomeKit Auto → set thermostat to programmed/scheduled mode.
      thermostats.setTemperatureToAuto(this.roomId, (err, json) => {
        if (err) {
          return callback(err);
        }
        this.log.debug('[DEBUG] setRoomAuto response:', json);
        callback(null);
      });
      break;
    default:
      callback(null);
      break;
    }
  },

  setTargetTemperature: function (value, callback) {
    this.log.debug('[DEBUG setTargetTemperature] setTargetTemperature called with value:', value);
    // this.log.debug("[DEBUG] Full room state at setTargetTemperature execution:", JSON.stringify(this.room, null, 2));

    // Synchronize the state with the API
    thermostats.getStatus((err, rooms) => {
      if (err) {
        this.log.error('[ERROR setTargetTemperature] Failed to synchronize room state:', err);
        return callback(err);
      }

      // Find the latest state for this room
      const updatedRoom = rooms.find((r) => r.roomId === this.roomId);
      if (!updatedRoom) {
        this.log.error('[ERROR setTargetTemperature] Room not found in updated state.');
        return callback(new Error('Room not found in updated state.'));
      }

      // Update local state
      this.room = updatedRoom;
      // this.log.debug("[DEBUG] Synchronized room state:", JSON.stringify(this.room, null, 2));

      this._applyTargetTemperature(value, callback);
    });
  },

  _applyTargetTemperature: function (value, callback) {
    this.log.debug(`[DEBUG _applyTargetTemperature] Setting target temperature for ${this.name} to ${value}°`);
    this.log.debug(`[DEBUG _applyTargetTemperature] Current State → locMode: ${this.room.locMode}, roomMode: \
${this.room.roomMode}, runMode: ${this.room.runMode}`);

    if (this.room.roomMode === 'program' && (this.room.runMode === 'schedule' || this.room.runMode === 'override')) {
      // AUTO or OVERRIDE → Set an override
      this.log.debug(`[DEBUG _applyTargetTemperature] Sending setOverride command for ${this.name} with value ${value}`);
      thermostats.setOverride(this.roomId, value, (err, json) => {
        if (err) {
          this.log.error('[ERROR _applyTargetTemperature] Failed to set override in AUTO mode:', err);
          return callback(err);
        }
        this.log.debug('[DEBUG _applyTargetTemperature] Override temperature set in AUTO mode:', json);
        callback(null);
      });
    } else if (this.room.roomMode === 'fixed' && this.room.runMode === 'fixed') {
      // FIXED → Update the fixed temperature
      this.log.debug(`[DEBUG _applyTargetTemperature] Sending setNewTemperature command for ${this.name} with value ${value}`);
      thermostats.setNewTemperature(this.roomId, value, (err, json) => {
        if (err) {
          this.log.error('[ERROR _applyTargetTemperature] Failed to update fixed temperature:', err);
          return callback(err);
        }
        this.log.debug('[DEBUG _applyTargetTemperature] Fixed temperature updated:', json);
        callback(null);
      });
    } else {
      // Fallback for unexpected states
      this.log.warn('[WARN _applyTargetTemperature] Unhandled state for target temperature. Defaulting to override.');
      this.log.debug(`[DEBUG _applyTargetTemperature] Sending setOverride command for ${this.name} with value ${value}`);
      thermostats.setOverride(this.roomId, value, (err, json) => {
        if (err) {
          this.log.error('[ERROR _applyTargetTemperature] Fallback failed to set override:', err);
          return callback(err);
        }
        this.log.debug('[DEBUG _applyTargetTemperature] Fallback: Override temperature set:', json);
        callback(null);
      });
    }
  },

  getServices: function () {
    this.log.debug('[DEBUG getServices] ============ Retrieving the accessory’s services.');

    // --- Accessory Information Service ---
    const informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'warmup-wifi-thermostats')
      .setCharacteristic(Characteristic.SerialNumber, hostname + '-' + this.name);
    //  .setCharacteristic(Characteristic.FirmwareRevision, require('../package.json').version);
  
    // --- Temperature Sensor Service ---
    this.temperatureService = new Service.TemperatureSensor(this.name + ' Air');
    const currentAirTemp = Number(this.room.airTemp / 10);
    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100,
      });
    this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
      .updateValue(currentAirTemp);

    // --- Thermostat Service ---
    this.thermostatService = new Service.Thermostat(this.name);
    this.thermostatService.isPrimaryService = true;
    // Limit valid values; cool (2) is removed.
    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [0, 1, 3],
      });
      
    // Set event handlers for changes from HomeKit.
    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('set', this.setTargetHeatingCooling.bind(this));
    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .on('set', this.setTargetTemperature.bind(this));

    // Set temperature limits for the TargetTemperature characteristic.
    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
        minValue: this.room.minTemp / 10,
        maxValue: this.room.maxTemp / 10,
      });
    
    // Update the Temperature values directly from the API data
    const initialTargetTemp = Number(this.room.targetTemp / 10);
    const initialCurrentTemp = Number(this.room.currentTemp / 10);
    this.thermostatService.getCharacteristic(Characteristic.TargetTemperature).updateValue(initialTargetTemp);
    this.thermostatService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(initialCurrentTemp);

    // --- Direct Mapping of Warmup API runMode to HomeKit states ---
    const mapRunModeToHomeKit = (runMode) => {
      switch (runMode) {
      case 'off':
        return 0;
      case 'override':
        // Override is displayed as auto.
        return 3;
      case 'program':
        return 3;
      case 'fixed':
      default:
        return 1;
      }
    };

    const hkState = mapRunModeToHomeKit(this.room.runMode);
    // We assume here that both the target and current states in HomeKit should mirror the device's runMode.
    this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(hkState);
    this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(hkState);

    return [informationService, this.thermostatService, this.temperatureService];
  },
};
