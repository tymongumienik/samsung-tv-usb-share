(function () {
  'use strict';
  var port = window.USB_SHARE_PORT || 8082;
  var base = 'http://127.0.0.1:' + port;
  var status = document.getElementById('status');
  var address = document.getElementById('address');
  var diagnostics = document.getElementById('diagnostics');
  var known = {};

  function errorString(e) { return (e && (e.name || e.code) || 'Error') + ': ' + (e && e.message || String(e)); }
  function xhr(method, route, body, type, done) {
    var x = new XMLHttpRequest();
    x.open(method, base + route, true);
    x.timeout = 40000;
    if (type) x.setRequestHeader('Content-Type', type);
    x.onload = function () { done(x.status >= 200 && x.status < 300 ? null : new Error('HTTP ' + x.status), x.responseText); };
    x.onerror = function () { done(new Error('Połączenie z portem ' + port + ' nie działa')); };
    x.ontimeout = function () { done(new Error('Timeout portu ' + port)); };
    try { x.send(body || null); } catch (e) { done(e); }
  }
  function jsonPost(route, data, done) { xhr('POST', route, JSON.stringify(data), 'application/json', done || function () {}); }
  function validPath(p) {
    if (typeof p !== 'string' || p.indexOf('\0') >= 0 || p.indexOf('\\') >= 0) return false;
    var parts = p.split('/');
    for (var i = 0; i < parts.length; i++) if (parts[i] === '.' || parts[i] === '..') return false;
    return p.charAt(0) !== '/';
  }
  function filePath(label, rel) { return label + (rel ? '/' + rel : ''); }
  function resolveFile(label, rel, done) {
    if (!known[label] || !validPath(rel)) return done(new Error('Nieznana pamięć lub niedozwolona ścieżka'));
    try { tizen.filesystem.resolve(filePath(label, rel), function (f) { done(null, f); }, function (e) { done(e); }, 'r'); }
    catch (e) { done(e); }
  }
  function report() {
    var out = { available: !!(window.tizen && tizen.filesystem), storages: [], errors: [] };
    if (!out.available) { out.errors.push('tizen.filesystem niedostępne w frontendzie'); send(out); return; }
    try {
      tizen.filesystem.listStorages(function (items) {
        known = {};
        var pending = items.length;
        if (!pending) return send(out);
        for (var i = 0; i < items.length; i++) (function (s) {
          var entry = { label: s.label, type: s.type, state: s.state, path: s.path || null };
          out.storages.push(entry);
          if (s.type !== 'EXTERNAL' || s.state !== 'MOUNTED') return finish();
          try {
            tizen.filesystem.resolve(s.label, function (f) {
              entry.resolved = { path: f.path || null, fullPath: f.fullPath || null, name: f.name || null };
              known[s.label] = true; finish();
            }, function (e) { entry.error = errorString(e); finish(); }, 'r');
          } catch (e) { entry.error = errorString(e); finish(); }
        })(items[i]);
        function finish() { pending--; if (!pending) send(out); }
      }, function (e) { out.errors.push('listStorages: ' + errorString(e)); send(out); });
    } catch (e) { out.errors.push('listStorages: ' + errorString(e)); send(out); }
    function send(data) {
      jsonPost('/bridge/report', data, function (e) { if (e) setTimeout(report, 2000); });
      diagnostics.textContent = JSON.stringify(data, null, 2);
    }
  }
  function execute(cmd) {
    var p = cmd.payload || {};
    if (!known[p.label] || !validPath(p.path)) return reply(cmd.id, { error: 'Nieznana pamięć lub niedozwolona ścieżka' });
    resolveFile(p.label, p.path, function (err, file) {
      if (err) return reply(cmd.id, { error: errorString(err) });
      if (cmd.op === 'stat') return reply(cmd.id, { name: file.name, size: file.fileSize, directory: file.isDirectory });
      if (cmd.op === 'list') {
        if (!file.isDirectory) return reply(cmd.id, { error: 'To nie jest katalog' });
        try {
          file.listFiles(function (files) {
            var items = [];
            for (var i = 0; i < files.length; i++) items.push({ name: files[i].name, size: files[i].fileSize, directory: files[i].isDirectory });
            reply(cmd.id, { items: items });
          }, function (e) { reply(cmd.id, { error: errorString(e) }); });
        } catch (e) { reply(cmd.id, { error: errorString(e) }); }
        return;
      }
      if (cmd.op !== 'read' || file.isDirectory) return reply(cmd.id, { error: 'Nieprawidłowa operacja' });
      var handle;
      try {
        // FileHandle.seek/readData use 64-bit offsets on Tizen 5.0.
        handle = tizen.filesystem.openFile(filePath(p.label, p.path), 'r');
        handle.seek(p.offset, 'BEGIN');
        var bytes = handle.readData(p.length);
        if (!bytes || bytes.length !== p.length) return reply(cmd.id, { error: 'Niepełny odczyt USB' });
        xhr('POST', '/bridge/result?id=' + encodeURIComponent(cmd.id), bytes, 'application/octet-stream', function (e) {
          if (e) status.textContent = errorString(e);
        });
      } catch (e) { reply(cmd.id, { error: errorString(e) }); }
      finally { if (handle) try { handle.close(); } catch (ignore) {} }
    });
  }
  function reply(id, data) { jsonPost('/bridge/result?id=' + encodeURIComponent(id), data); }
  function poll() {
    xhr('GET', '/bridge/next', null, null, function (err, result) {
      if (err) { status.textContent = errorString(err); return setTimeout(poll, 2000); }
      try { if (result) execute(JSON.parse(result)); } catch (e) { status.textContent = errorString(e); }
      setTimeout(poll, 0);
    });
  }
  function refresh() {
    xhr('GET', '/debug', null, null, function (err, result) {
      if (err) { status.textContent = errorString(err); return; }
      try {
        var info = JSON.parse(result);
        diagnostics.textContent = JSON.stringify(info, null, 2);
        status.innerHTML = info.server.listening ? '<span class="ok">USB Share running</span>' : '<span class="bad">Serwer nie działa</span>';
        var ip = info.server.ips && info.server.ips[0];
        address.textContent = ip ? 'http://' + ip + ':' + info.server.port : 'Brak adresu IPv4 LAN';
      } catch (e) { diagnostics.textContent = result; }
    });
  }
  document.getElementById('refresh').onclick = function () { report(); refresh(); };
  report(); poll(); refresh(); setInterval(refresh, 10000);
})();
