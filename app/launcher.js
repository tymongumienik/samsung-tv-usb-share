(function () {
  'use strict';
  window.USB_SHARE_PORT = 8082;
  var started = false;
  function loadFrontend() {
    if (started) return;
    started = true;
    var script = document.createElement('script');
    script.src = 'app/app.js';
    document.body.appendChild(script);
  }
  function failed(e) {
    document.getElementById('status').textContent = 'Start usługi: ' + (e && e.message || String(e));
    loadFrontend();
  }
  function fallback(e) {
    try {
      tizen.application.launchAppControl(
        new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default'),
        'u5bShare01.USBShareService', loadFrontend, failed
      );
    } catch (secondError) { failed(secondError || e); }
  }
  setTimeout(loadFrontend, 5000);
  try {
    tizen.application.launch('u5bShare01.USBShareService', loadFrontend, fallback);
  } catch (e) { fallback(e); }
})();
