'use strict';

var usbShare = null;

module.exports.onStart = function () {
  if (usbShare) return;
  process.env.USB_SHARE_PORT = '8082';
  usbShare = require('./server.js');
};

function stop() {
  if (usbShare && usbShare.server) usbShare.server.close();
  usbShare = null;
}

module.exports.onStop = stop;
module.exports.onExit = stop;
