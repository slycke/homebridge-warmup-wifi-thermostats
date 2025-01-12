const debug = require('debug')('warmup4ie:lib');
const request = require('request');

const TOKEN_URL = 'https://api.warmup.com/apps/app/v1';
const APP_TOKEN = 'M=;He<Xtg"$}4N%5k{$:PD+WA"]D<;#PriteY|VTuA>_iyhs+vA"4lic{6-LqNM:';
const HEADER = {
  'user-agent': 'WARMUP_APP',
  'accept-encoding': 'br, gzip, deflate',
  'accept': '*/*',
  'Connection': 'keep-alive',
  'content-type': 'application/json',
  'app-token': APP_TOKEN,
  'app-version': '1.8.1',
  'accept-language': 'de-de'
};

let WarmupAccessToken = null;
let LocId = null;

class Warmup4IE {
  constructor(options, callback) {
    this._username = options.username;
    this._password = options.password;
    this._location_name = options.location;
    this._room_name = options.room;
    this._target_temperature = options.target_temp;
    this._refresh = options.refresh;
    this._duration = options.duration;
    this.room = [];

    this.setup_finished = false;

    this._generateAccessToken(() => {
      this._getLocations(() => {
        this.getStatus((err, rooms) => {
          callback(null, rooms);
        });
      });
    });

    this.refreshInterval = setInterval(this.pollDevices.bind(this), (this._refresh * 1000) / 2);
  }

  pollDevices() {
    this.getStatus(() => { });
  }

  _sendRequest(body, callback) {
    request({
      method: 'POST',
      url: TOKEN_URL,
      timeout: 10000,
      strictSSL: false,
      headers: HEADER,
      body: JSON.stringify(body)
    }, (err, response) => {
      if (err || response.statusCode !== 200) {
        const error = err || new Error(`HTTP Error: ${response.statusCode}`);
        console.error(error);
        return callback(error);
      }

      try {
        const json = JSON.parse(response.body);
        // Log the entire API response:
        // console.log('Warmup4IE API request body:', JSON.stringify(body));
        // console.log('Warmup4IE API raw response:', response.body);
        // console.log('Warmup4IE API parsed JSON:', JSON.stringify(json, null, 2));
        callback(null, json);
      } catch (ex) {
        console.error('JSON Parsing Error:', ex);
        callback(ex);
      }
    });
  }

  _generateAccessToken(callback) {
    const body = {
      request: {
        email: this._username,
        password: this._password,
        method: 'userLogin',
        appId: 'WARMUP-APP-V001'
      }
    };

    this._sendRequest(body, (err, json) => {
      if (err) return callback(err);

      WarmupAccessToken = json.response.token;
      callback(null);
    });
  }

  _getLocations(callback) {
    if (!WarmupAccessToken) return callback(new Error('Missing access token.'));

    const body = {
      account: {
        email: this._username,
        token: WarmupAccessToken
      },
      request: {
        method: 'getLocations'
      }
    };

    this._sendRequest(body, (err, json) => {
      if (err) return callback(err);

      LocId = json.response.locations[0]?.id;
      callback(null);
    });
  }

  getStatus(callback) {
    if (!LocId || !WarmupAccessToken) {
      return callback(new Error('Missing LocId or AccessToken.'));
    }
  
    const body = {
      account: { email: this._username, token: WarmupAccessToken },
      request: { method: 'getRooms', locId: LocId }
    };
  
    this._sendRequest(body, (err, json) => {
      if (err) return callback(err);
  
      const locMode = json.response.locMode;          // e.g. "off", "frost", etc.
      const rooms = json.response.rooms || [];
  
      rooms.forEach(room => {
        // If location itself is set to "off", force each room to "off"
        if (locMode === "off") {
          room.runMode = "off";
        }
        this.room[room.roomId] = room;
      });
  
      callback(null, rooms);
    });
  }

  _setLocationMode(locationId, locMode, callback) {
    const body = {
      account: {
        email: this._username,
        token: WarmupAccessToken
      },
      request: {
        method: 'setModes',
        values: {
          locId: locationId,
          locMode: locMode,
          holEnd: "-",
          holStart: "-",
          holTemp: "-",
          geoMode: "0"
        }
      }
    };
  
    // Clear cached data for this location (if applicable)
    this.room[locationId] = null;
    this._sendRequest(body, (err, json) => {
      if (err) return callback(err);
      this.getStatus((err, rooms) => {
        if (err) {
          console.error("[ERROR] Failed to refresh devices after state change:", err);
        } else {
          console.log("[DEBUG] Successfully refreshed devices after state change:", rooms);
        }
      });
      callback(null, json);
    });
  }

  _setTemperature(roomId, mode, temperature, callback) {
    if (!WarmupAccessToken) return callback(new Error("Missing access token"));
    const body = {
      account: {
        email: this._username,
        token: WarmupAccessToken
      },
      request: {
        method: 'setProgramme',
        roomId: roomId,
        roomMode: mode  // "prog" (AUTO) or "fixed" (MANUAL)
      }
    };
    // If a temperature is provided, include it. (API expects a string, in tenths of a degree, padded to three digits.)
    if (temperature !== undefined && temperature !== null) {
      body.request.fixed = {
        fixedTemp: String(parseInt(temperature * 10, 10)).padStart(3, '0')
      };
    }
    this._sendRequest(body, (err, json) => {
      if (err) return callback(err);
      this.getStatus((err, rooms) => {
        if (err) {
          console.error("[ERROR] Failed to refresh devices after state change:", err);
        } else {
          console.log("[DEBUG] Successfully refreshed devices after state change:", rooms);
        }
      });
      callback(null, json);
    });
  }

  setOverride(roomId, temperature, callback) {
    const durationMinutes = this._duration || 60; // Default to 60 minutes if not configured
    const until = new Date(Date.now() + durationMinutes * 60000).toISOString().slice(11, 16); // Time in HH:mm format

    const body = {
      account: {
        email: this._username,
        token: WarmupAccessToken
      },
      request: {
        method: 'setOverride',
        rooms: [roomId],
        type: 3,  // Assumed constant for override
        temp: String(parseInt(temperature * 10, 10)).padStart(3, '0'),
        until: until
      }
    };
  
    // this.room[roomId] = null;
    // console.log("[DEBUG] Override request body:", JSON.stringify(body, null, 2));
    this._sendRequest(body, (err, json) => {
      if (err) return callback(err);
      this.getStatus((err, rooms) => {
        if (err) {
          console.error("[ERROR] Failed to refresh devices after state change:", err);
        } else {
          console.log("[DEBUG] Successfully refreshed devices after state change:", rooms);
        }
      });
      callback(null, json);
    });
  }

  setTemperatureToAuto(roomId, callback) {
    // Set room mode to AUTO; we use "prog" here.
    return this._setTemperature(roomId, "prog", null, callback);
  }
  
  setTemperatureToManual(roomId, callback) {
    // Set room mode to manual but do not change the setpoint.
    return this._setTemperature(roomId, "fixed", null, callback);
  }
  
  setNewTemperature(roomId, newTemperature, callback) {
    // Set room mode to manual AND update the fixed temperature.
    return this._setTemperature(roomId, "fixed", newTemperature, callback);
  }

  setLocationToFrost(locationId, callback) {
    // Set the location mode to "frost"
    this._setLocationMode(locationId, "frost", callback);
  }
  
  setLocationToOff(locationId, callback) {
    // Set the location mode to "off"
    this._setLocationMode(locationId, "off", callback);
  }

  destroy() {
    console.log('Destroying Warmup4IE');
    clearInterval(this.refreshInterval);
  }
}

module.exports = { Warmup4IE };
