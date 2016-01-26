'use strict';

angular.module('experience.services.experience', [
  'ngCordova',
  'ngWebSocket',
  'experience.services.store',
])

.constant('bleServices', {
  experience: {
    uuid: '6b00',
    characteristics: {
      extreme: {
        uuid: '6b01',
      },
      control: {
        uuid: '6bff',
      },
      amplitude: {
        uuid: '6b04',
      },
      rhythm: {
        uuid: '6b05',
      },
      frequency: {
        uuid: '6b06',
      },
    },
  },
  led: {
    uuid: '6c00',
    characteristics: {
      led: {
        uuid: '6c01',
      },
    },
  },
})

.service('experienceService', function($rootScope, $cordovaBLE, $websocket, $q, $log, storeService, bleServices, scoreTypes) {
  // some shortcuts
  var bls = bleServices;
  var scoreUUIDs = [
    bls.experience.characteristics.amplitude.uuid,
    bls.experience.characteristics.rhythm.uuid,
    bls.experience.characteristics.frequency.uuid,
  ];

  var scanning = false;
  var websocket = null;

  var enable = function() {
    var q = $q.defer();

    try {
      ble.isEnabled;
    } catch (e) {
      $log.error('no ble, no fun');
      q.reject(e);
      return q.promise;
    }

    $cordovaBLE.isEnabled().then(function() { // already enabled
      q.resolve();
    }).catch(function(error) { // not enabled
      if (typeof ble.enable === 'undefined') {
        // iOS doesn't have ble.enable
        q.reject('cannot enable bluetooth, probably on iOS');
      } else {
        // Android
        $log.debug('enabling bluetooth');
        $cordovaBLE.enable().then(function() {
          $log.info('bluetooth enabled');
          q.resolve();
        }).catch(function(error) {
          $log.warn('bluetooth not enabled');
          q.reject(error);
        });
      }
    });

    return q.promise;
  };

  var scan = function() {
    var q = $q.defer();
    $log.debug('starting ble scan');
    scanning = true;

    $cordovaBLE.startScan([bls.experience.uuid], function(device) {
      var deviceID = device.id;
      if (storeService.isPaired()) { // paired
        if (storeService.getPairedID() == deviceID) { // found paired device
          $log.info('found paired ' + deviceID);
          stopScan().then(function() {
            q.resolve(deviceID);
          });
        } else { // found another (not paired) device
          $log.info('found not paired ' + deviceID);
        }

      } else { // not paired yet
        if (!storeService.isIgnored(deviceID)) { // found new (not ignored) device
          $log.info('found ' + deviceID);
          stopScan().then(function() {
            q.resolve(deviceID);
          });
        } else { // found ignored
          $log.info('found ignored ' + deviceID);
          q.notify(deviceID);
        }
      }
    }, q.reject);

    $log.info('scanning started');
    return q.promise;
  };

  var stopScan = function() {
    if (!scanning) return $q.resolve();
    $log.debug('stopping ble scan');
    return $cordovaBLE.stopScan().then(function(result) {
      $log.info('scanning stopped');
      scanning = false;
      return result;
    }).catch(function(error) {
      $log.error('scanning stop failed');
      throw error;
    });
  };

  var connect = function(deviceID) {
    var q = $q.defer();
    $log.debug('connecting to ' + deviceID);

    ble.connect(deviceID,
      function(device) {
        $log.info('connected to ' + deviceID);
        storeService.setDeviceID(deviceID);
        $rootScope.$broadcast('experienceConnectionStateChanged', true);
        q.resolve(deviceID);
      },

      function(error) {
        $log.error('connecting to ' + deviceID + ' failed / device disconnected later');
        $rootScope.$broadcast('experienceConnectionStateChanged', false);
        q.reject(error);
      });

    return q.promise;
  };

  var reconnect = function() {
    if (!storeService.isPaired()) return $q.reject('unable to reconnect, no device is paired');
    return isConnected().then(function(connected) {
      if (connected) return;
      else return scan().then(connect);
    });
  };

  var disconnect = function() {
    return isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';
      $log.debug('disconnecting from ' + storeService.getDeviceID());

      return $cordovaBLE.disconnect(storeService.getDeviceID()).then(function(result) {
        $rootScope.$broadcast('experienceConnectionStateChanged', false);
        $log.info('disconnected from ' + storeService.getDeviceID());
        return result;
      }).catch(function(error) {
        $log.error('disconnecting from ' + deviceID + ' failed');
        throw error;
      });
    });
  };

  var ignore = function() {
    if (!storeService.getDeviceID()) return $q.reject('unable to ignore, no device is paired');
    storeService.ignore(storeService.getDeviceID());
    $log.info(storeService.getDeviceID() + ' added to ignore list');
    return $q.resolve();
  };

  var clearIgnored = function() {
    storeService.clearIgnored();
    return $q.resolve();
  };

  var setColor = function(color) {
    return isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';
      $log.debug('setting color to ' + color);

      var data = new Uint8Array(3);
      data[0] = parseInt(color.substring(1, 3), 16); // red
      data[1] = parseInt(color.substring(3, 5), 16); // green
      data[2] = parseInt(color.substring(5, 7), 16); // blue

      return $cordovaBLE.write(storeService.getDeviceID(), bls.led.uuid, bls.led.characteristics.led.uuid, data.buffer).then(function() {
        $log.info('color set to ' + color);
      }).catch(function(error) {
        $log.error('setting color failed');
        throw error;
      });
    });
  };

  var clearColor = function() {
    return setColor('#000000');
  };

  var startMeasurement = function() {
    return isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';
      $log.debug('starting measurement');

      var deviceID = storeService.getDeviceID();

      // BLE raw data
      var zeroScore = new Float32Array([0]);
      var startMeasurementCommand = new Uint8Array([0x1]);

      // for each score type
      angular.forEach(scoreUUIDs, function(uuid) {
        $cordovaBLE.write(deviceID, bls.experience.uuid, uuid, zeroScore.buffer); // delete previous scores
        $cordovaBLE.startNotification(deviceID, bls.experience.uuid, uuid, function(data) { // register callback
          // get score from BLE raw data
          var score = new Float32Array(data)[0];

          // mapping of BLE characteristics to SQLite score types
          var type;
          switch (uuid) {
            case bls.experience.characteristics.amplitude.uuid:
              type = scoreTypes.amplitude;
              break;
            case bls.experience.characteristics.frequency.uuid:
              type = scoreTypes.frequency;
              break;
            case bls.experience.characteristics.rhythm.uuid:
              type = scoreTypes.rhythm;
              break;
          }

          storeService.addScore(score, type);
        });
      });

      // start measurement
      return $cordovaBLE.write(deviceID, bls.experience.uuid, bls.experience.characteristics.control.uuid, startMeasurementCommand.buffer)
        .then(storeService.startLesson)
        .then(function() {
          $log.info('measurement started');
        }).catch(function(error) {
          $log.error('starting measurement failed');
          throw error;
        });
    });
  };

  var stopMeasurement = function() {
    return isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';
      $log.debug('stopping measurement');

      var deviceID = storeService.getDeviceID();

      // BLE raw data
      var stopMeasurementCommand = new Uint8Array([0xff]);

      // unregister callbacks
      angular.forEach(scoreUUIDs, function(uuid) {
        $cordovaBLE.stopNotification(deviceID, bls.experience.uuid, uuid);
      });

      // stop measurement
      return $cordovaBLE.write(storeService.getDeviceID(), bls.experience.uuid, bls.experience.characteristics.control.uuid, stopMeasurementCommand.buffer)
        .then(storeService.endLesson)
        .then(function() {
          $log.info('measurement stopped');
        }).catch(function(error) {
          $log.error('stopping measurement failed');
          throw error;
        });
    });
  };

  // DEV function
  var _sendCommand = function(cmd) {
    return isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';
      $log.debug('sending command ' + cmd);

      var data = new Uint8Array([cmd]);

      // FIXME writeWithoutResponse not working on iOS
      return $cordovaBLE.writeWithoutResponse(storeService.getDeviceID(), bls.experience.uuid, bls.experience.characteristics.control.uuid, data.buffer).then(function() {
        $log.info('command ' + cmd + ' sent');
      }).catch(function(error) {
        $log.error('sending command failed');
        throw error;
      });
    });
  };

  var subscribeExtremes = function(websocketIP, websocketPort) {
    var q = $q.defer();

    isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';

      var address = 'ws://' + [websocketIP, websocketPort].join(':');
      $log.debug('subscribing extremes and streaming to ' + address);

      websocket = $websocket(address);

      websocket.onOpen(function() {
        $cordovaBLE.startNotification(storeService.getDeviceID(), bls.experience.uuid, bls.experience.characteristics.extreme.uuid, function(data) {
          var dataView = new DataView(data);
          var t = dataView.getUint32(0, true);
          var x = dataView.getInt16(4, true);
          var y = dataView.getInt16(6, true);
          var z = dataView.getInt16(8, true);
          var message = [t, x, y, z].join('\t');
          $log.debug('sending WS message: ' + message);
          websocket.send(message);
        });

        $log.info('extremes subscribed');
        q.resolve();
      });

    });

    return q.promise;
  };

  var unsubscribeExtremes = function() {
    return isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';
      $log.debug('unsubscribing extremes');

      $cordovaBLE.stopNotification(storeService.getDeviceID(), bls.experience.uuid, bls.experience.characteristics.extreme.uuid);
      websocket.close();
      $log.info('extremes unsubscribed');
    });
  };

  var pair = function() {
    return isConnected().then(function(connected) {
      if (!connected) throw 'experience not connected';

      $log.info('device ' + storeService.getDeviceID() + ' paired');
      storeService.setPairedID(storeService.getDeviceID());
    });
  };

  var unpair = function() {
    storeService.setPairedID(null);
    $log.info('device ' + storeService.getDeviceID() + ' unpaired');
    return $q.resolve();
  };

  var isConnected = function() {
    var q = $q.defer();
    var deviceID = storeService.getDeviceID();

    // no deviceID = not connected
    if (!deviceID) {
      q.resolve(false);
      return q.promise;
    }

    $log.debug('checking connection status for ' + deviceID);
    $cordovaBLE.isConnected(deviceID).then(function() {
      $log.debug(deviceID + ' is connected');
      q.resolve(true);
    }).catch(function() {
      $log.debug(deviceID + ' is not connected');
      q.resolve(false);
    });

    return q.promise;
  };

  // service public API
  this.enable = enable;
  this.scan = scan;
  this.stopScan = stopScan;
  this.connect = connect;
  this.reconnect = reconnect;
  this.disconnect = disconnect;
  this.ignore = ignore;
  this.clearIgnored = clearIgnored;
  this.setColor = setColor;
  this.clearColor = clearColor;
  this.startMeasurement = startMeasurement;
  this.stopMeasurement = stopMeasurement;
  this.pair = pair;
  this.unpair = unpair;
  this.isConnected = isConnected;

  // DEV functions
  this.subscribeExtremes = subscribeExtremes;
  this.unsubscribeExtremes = unsubscribeExtremes;
  this._sendCommand = _sendCommand;

});
