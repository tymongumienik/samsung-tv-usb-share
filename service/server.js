(function () {
  'use strict';
  // The WGT includes this service as a self-contained script.
  var http = require('http');
  var fs = require('fs');
  var path = require('path');
  var os = require('os');
  var url = require('url');
  var Buffer = require('buffer').Buffer;
  var PORT = Number(process.env.USB_SHARE_PORT) || 8082;
  var MAX_JSON = 2 * 1024 * 1024;
  var CHUNK = 64 * 1024;
  var candidates = ['/opt/usr/storage', '/opt/storage', '/opt/media', '/media', '/mnt', '/run/media', '/opt/usr/media'];
  var state = { server: { port: PORT, listening: false, error: null, ips: [], interfaces: {} }, node: {}, tizenService: {}, tizenWeb: null, roots: [] };
  var jobs = {};
  var queue = [];
  var waiter = null;
  var serial = 0;
  var lastPoll = 0;

  function err(e) { return { code: e && (e.code || e.name) || 'Error', message: e && e.message || String(e) }; }
  function safeInteger(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && Math.abs(n) <= 9007199254740991; }
  function ipInfo() {
    var net;
    try { net = os.networkInterfaces(); }
    catch (e) { state.server.networkError = err(e); net = {}; }
    var ips = [];
    Object.keys(net).forEach(function (name) {
      (net[name] || []).forEach(function (a) {
        if ((a.family === 'IPv4' || a.family === 4) && !a.internal) ips.push(a.address);
      });
    });
    state.server.interfaces = net;
    state.server.ips = ips;
  }
  function inspectDir(dir) {
    var out = { path: dir };
    try {
      out.realPath = fs.realpathSync(dir);
      out.entries = fs.readdirSync(dir).slice(0, 100).map(function (name) {
        var p = path.join(dir, name);
        try { var s = fs.statSync(p); return { name: name, directory: s.isDirectory(), size: s.size }; }
        catch (e) { return { name: name, error: err(e) }; }
      });
    } catch (e) { out.error = err(e); }
    return out;
  }
  function decodeMount(s) { return s.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\012/g, '\n').replace(/\\134/g, '\\'); }
  function usbMount(m) {
    var p = m.point.toLowerCase();
    if (!candidates.some(function (c) { return p === c || p.indexOf(c + '/') === 0; })) return false;
    return /^\/dev\/sd[a-z]/.test(m.device) || /\b(usb|external|removable)\b|\/sd[a-z][0-9]/.test(p) || /^(vfat|exfat|ntfs|fuseblk|ufsd)$/.test(m.type);
  }
  function scanNode() {
    var report = { nodeVersion: process.version, directories: [], mounts: [], mountError: null };
    candidates.forEach(function (p) { report.directories.push(inspectDir(p)); });
    try {
      fs.readFileSync('/proc/mounts', 'utf8').split('\n').forEach(function (line) {
        var cols = line.split(' ');
        if (cols.length < 3) return;
        var m = { device: decodeMount(cols[0]), point: decodeMount(cols[1]), type: cols[2] };
        if (candidates.some(function (c) { return m.point === c || m.point.indexOf(c + '/') === 0; })) report.mounts.push(m);
      });
    } catch (e) { report.mountError = err(e); }
    state.node = report;
    state.roots = state.roots.filter(function (r) { return r.mode !== 'node'; });
    report.mounts.filter(usbMount).forEach(function (m, i) {
      try {
        var real = fs.realpathSync(m.point);
        if (fs.statSync(real).isDirectory()) {
          fs.accessSync(real, 5); // POSIX R_OK | X_OK, without reading a huge USB directory.
          state.roots.push({ id: 'node' + i, label: path.basename(m.point) || m.point, mode: 'node', root: real });
        }
      } catch (e) { m.accessError = err(e); }
    });
  }
  function scanTizenService() {
    var report = { available: false, storages: [], errors: [] };
    state.tizenService = report;
    try {
      if (typeof tizen === 'undefined' || !tizen.filesystem) { report.errors.push('tizen.filesystem niedostępne w serviceFile'); return; }
      report.available = true;
      tizen.filesystem.listStorages(function (items) {
        items.forEach(function (s) {
          var item = { label: s.label, type: s.type, state: s.state, path: s.path || null };
          report.storages.push(item);
          if (s.type === 'EXTERNAL' && s.state === 'MOUNTED') {
            try { tizen.filesystem.resolve(s.label, function (f) {
              item.resolved = { path: f.path || null, fullPath: f.fullPath || null };
            }, function (e) { item.error = err(e); }, 'r'); }
            catch (e) { item.error = err(e); }
          }
        });
      }, function (e) { report.errors.push(err(e)); });
    } catch (e) { report.errors.push(err(e)); }
  }
  function validRel(value) {
    if (typeof value !== 'string' || value.charAt(0) === '/' || /[\\\0]/.test(value)) return false;
    var pieces = value.split('/');
    return !pieces.some(function (p) { return p === '.' || p === '..' || p === ''; }) || value === '';
  }
  function inside(root, target) { return target === root || target.indexOf(root + path.sep) === 0; }
  function safeNode(root, rel, cb) {
    if (!validRel(rel)) return cb(new Error('Niedozwolona ścieżka'));
    var candidate = path.resolve(root.root, rel);
    if (!inside(root.root, candidate)) return cb(new Error('Niedozwolona ścieżka'));
    fs.realpath(candidate, function (e, real) {
      if (e) return cb(e);
      if (!inside(root.root, real)) return cb(new Error('Symlink prowadzi poza USB'));
      cb(null, real);
    });
  }
  function findRoot(id) { return state.roots.filter(function (r) { return r.id === id; })[0]; }
  function sendJson(res, status, value) {
    var data = JSON.stringify(value, null, 2);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
    res.end(data);
  }
  function sendText(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(value);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function collect(req, max, cb) {
    var chunks = [], size = 0, failed = false;
    req.on('data', function (b) {
      size += b.length;
      if (size > max) { failed = true; req.destroy(); return; }
      chunks.push(b);
    });
    req.on('end', function () { if (!failed) cb(null, Buffer.concat(chunks)); });
    req.on('error', function (e) { if (!failed) cb(e); });
  }
  function remoteLocal(req) { return /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress); }
  function cors(req, res) {
    if (!remoteLocal(req)) return false;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return true;
  }
  function deliver() {
    if (!waiter || !queue.length) return;
    var res = waiter;
    waiter = null;
    clearTimeout(res.pollTimer);
    sendJson(res, 200, queue.shift());
  }
  function ask(op, payload, cb) {
    if (Date.now() - lastPoll > 45000) return cb(new Error('Frontend TV nie odpowiada. Otwórz USB Share na telewizorze.'));
    var id = String(++serial);
    var timer = setTimeout(function () {
      delete jobs[id];
      queue = queue.filter(function (item) { return item.id !== id; });
      cb(new Error('Timeout mostu Web API'));
    }, 40000);
    jobs[id] = { callback: cb, timer: timer, op: op };
    queue.push({ id: id, op: op, payload: payload });
    deliver();
  }
  function list(root, rel, cb) {
    if (root.mode === 'web') return ask('list', { label: root.label, path: rel }, function (e, data) {
      if (e) return cb(e);
      if (data.error) return cb(new Error(data.error));
      cb(null, data.items || []);
    });
    safeNode(root, rel, function (e, real) {
      if (e) return cb(e);
      fs.readdir(real, function (e, names) {
        if (e) return cb(e);
        var items = [];
        names.forEach(function (name) {
          try {
            var target = fs.realpathSync(path.join(real, name));
            if (!inside(root.root, target)) return;
            var s = fs.statSync(target);
            if (s.isDirectory() || s.isFile()) items.push({ name: name, size: s.size, directory: s.isDirectory() });
          } catch (ignore) {}
        });
        cb(null, items);
      });
    });
  }
  function stat(root, rel, cb) {
    if (root.mode === 'web') return ask('stat', { label: root.label, path: rel }, function (e, data) {
      if (e) return cb(e);
      if (data.error) return cb(new Error(data.error));
      cb(null, data);
    });
    safeNode(root, rel, function (e, real) {
      if (e) return cb(e);
      fs.stat(real, function (e, s) { if (e) return cb(e); cb(null, { name: path.basename(real), size: s.size, directory: s.isDirectory(), real: real }); });
    });
  }
  function layout(title, body) {
    return '<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(title) + '</title>' +
      '<style>body{font:18px Arial,sans-serif;margin:20px;max-width:900px}li{padding:9px;border-bottom:1px solid #ddd}a{color:#075ab7}small{color:#555}header{margin-bottom:24px}</style>' +
      '<header><h1>USB Share</h1><a href="/">Pamięci USB</a> · <a href="/debug">Diagnostyka /debug</a></header>' + body + '</html>';
  }
  function browse(res, id, rel) {
    var root = findRoot(id);
    if (!root || !validRel(rel)) return sendText(res, 400, 'Nieprawidłowa pamięć lub ścieżka');
    list(root, rel, function (e, items) {
      if (e) return sendText(res, 403, e.message);
      items.sort(function (a, b) { return Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name); });
      var parent = rel.indexOf('/') < 0 ? '' : rel.substring(0, rel.lastIndexOf('/'));
      var html = '<h2>' + escapeHtml(root.label) + ' / ' + escapeHtml(rel) + '</h2>';
      html += '<p><a href="' + (rel ? '/browse?s=' + encodeURIComponent(id) + '&p=' + encodeURIComponent(parent) : '/') + '">← Wstecz</a></p><ul>';
      items.forEach(function (item) {
        var next = rel ? rel + '/' + item.name : item.name;
        var dest = (item.directory ? '/browse' : '/file') + '?s=' + encodeURIComponent(id) + '&p=' + encodeURIComponent(next);
        html += '<li>' + (item.directory ? '📁 ' : '📄 ') + '<a href="' + dest + '">' + escapeHtml(item.name) + '</a>' +
          (item.directory ? '' : ' <small>(' + escapeHtml(item.size) + ' B)</small> <a download href="' + dest + '">Pobierz</a>') + '</li>';
      });
      html += '</ul>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(layout('USB Share', html));
    });
  }
  function range(header, size) {
    if (!header) return { start: 0, end: size - 1, partial: false };
    var m = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!m || (!m[1] && !m[2]) || !size) return null;
    var start, end;
    if (!m[1]) { var suffix = Number(m[2]); if (!suffix || !isFinite(suffix)) return null; start = Math.max(0, size - suffix); end = size - 1; }
    else { start = Number(m[1]); end = m[2] ? Number(m[2]) : size - 1; }
    if (!safeInteger(start) || !safeInteger(end) || start >= size || end < start) return null;
    return { start: start, end: Math.min(end, size - 1), partial: true };
  }
  function mime(name) {
    var ext = path.extname(name).toLowerCase();
    return { '.mp4':'video/mp4', '.mkv':'video/x-matroska', '.avi':'video/x-msvideo', '.mp3':'audio/mpeg', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.pdf':'application/pdf', '.txt':'text/plain; charset=utf-8', '.zip':'application/zip' }[ext] || 'application/octet-stream';
  }
  function download(req, res, id, rel) {
    var root = findRoot(id);
    if (!root || !validRel(rel) || !rel) return sendText(res, 400, 'Nieprawidłowa pamięć lub ścieżka');
    stat(root, rel, function (e, info) {
      if (e) return sendText(res, 403, e.message);
      if (info.directory) return sendText(res, 400, 'To jest katalog');
      var size = Number(info.size);
      if (!safeInteger(size) || size < 0) return sendText(res, 500, 'Nieprawidłowy rozmiar pliku');
      var part = range(req.headers.range, size);
      if (!part) { res.writeHead(416, { 'Content-Range':'bytes */' + size, 'Accept-Ranges':'bytes' }); return res.end(); }
      var filename = String(info.name || path.basename(rel)).replace(/[\r\n"\\]/g, '_');
      var fallback = filename.replace(/[^ -~]/g, '_').replace(/["\\]/g, '_');
      var headers = { 'Content-Type': mime(filename), 'Content-Length': String(part.end - part.start + 1),
        'Content-Disposition': 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename),
        'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
      if (part.partial) headers['Content-Range'] = 'bytes ' + part.start + '-' + part.end + '/' + size;
      res.writeHead(part.partial ? 206 : 200, headers);
      if (req.method === 'HEAD' || size === 0) return res.end();
      if (root.mode === 'node') {
        var stream = fs.createReadStream(info.real, { start: part.start, end: part.end, highWaterMark: CHUNK });
        stream.on('error', function () { res.destroy(); });
        res.on('close', function () { stream.destroy(); });
        stream.pipe(res);
      } else {
        var offset = part.start, closed = false;
        res.on('close', function () { closed = true; });
        function next() {
          if (closed) return;
          if (offset > part.end) return res.end();
          var length = Math.min(CHUNK, part.end - offset + 1);
          ask('read', { label: root.label, path: rel, offset: offset, length: length }, function (e, data) {
            if (closed) return;
            if (e || !Buffer.isBuffer(data) || data.length !== length) return res.destroy();
            offset += data.length;
            res.write(data, next);
          });
        }
        next();
      }
    });
  }
  function handleBridge(req, res, parsed) {
    if (!cors(req, res)) return sendText(res, 403, 'Tylko localhost');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (parsed.pathname === '/bridge/next' && req.method === 'GET') {
      lastPoll = Date.now();
      if (waiter) { clearTimeout(waiter.pollTimer); waiter.writeHead(204); waiter.end(); }
      waiter = res;
      res.pollTimer = setTimeout(function () { if (waiter === res) waiter = null; res.writeHead(204); res.end(); }, 25000);
      res.on('close', function () { if (waiter === res) { waiter = null; clearTimeout(res.pollTimer); } });
      return deliver();
    }
    if (parsed.pathname === '/bridge/report' && req.method === 'POST') return collect(req, MAX_JSON, function (e, b) {
      if (e) return sendText(res, 400, e.message);
      try {
        var report = JSON.parse(b.toString('utf8'));
        state.tizenWeb = report;
        state.roots = state.roots.filter(function (r) { return r.mode !== 'web'; });
        (report.storages || []).forEach(function (s) {
          if (s.type === 'EXTERNAL' && s.state === 'MOUNTED' && s.resolved && !s.error && typeof s.label === 'string') {
            state.roots.push({ id: 'web:' + s.label, label: s.label, mode: 'web' });
          }
        });
        sendJson(res, 200, { ok: true, roots: state.roots });
      } catch (ex) { sendText(res, 400, ex.message); }
    });
    if (parsed.pathname === '/bridge/result' && req.method === 'POST') {
      var job = jobs[parsed.query.id];
      if (!job) return sendText(res, 404, 'Zadanie wygasło');
      return collect(req, job.op === 'read' ? CHUNK : MAX_JSON, function (e, b) {
        delete jobs[parsed.query.id]; clearTimeout(job.timer);
        if (e) { job.callback(e); return sendText(res, 400, e.message); }
        if (job.op === 'read' && req.headers['content-type'] === 'application/octet-stream') job.callback(null, b);
        else { try { job.callback(null, JSON.parse(b.toString('utf8'))); } catch (ex) { job.callback(ex); } }
        sendJson(res, 200, { ok: true });
      });
    }
    sendText(res, 404, 'Brak endpointu');
  }
  function handler(req, res) {
    var parsed = url.parse(req.url, true);
    if (parsed.pathname.indexOf('/bridge/') === 0) return handleBridge(req, res, parsed);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Metoda niedozwolona');
    if (parsed.pathname === '/debug') {
      ipInfo(); scanNode(); return sendJson(res, 200, state);
    }
    if (parsed.pathname === '/') {
      var html = '<h2>Dostępne pamięci</h2><ul>';
      state.roots.forEach(function (r) { html += '<li><a href="/browse?s=' + encodeURIComponent(r.id) + '&p=">' + escapeHtml(r.label) + '</a> <small>(' + escapeHtml(r.mode) + ')</small></li>'; });
      html += '</ul>' + (state.roots.length ? '' : '<p>Nie wykryto USB. Otwórz aplikację na TV i sprawdź <a href="/debug">/debug</a>.</p>');
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
      return res.end(layout('USB Share', html));
    }
    if (parsed.pathname === '/browse') return browse(res, parsed.query.s, parsed.query.p || '');
    if (parsed.pathname === '/file') return download(req, res, parsed.query.s, parsed.query.p || '');
    sendText(res, 404, 'Nie znaleziono');
  }
  ipInfo(); scanNode(); scanTizenService();
  var server = http.createServer(handler);
  server.on('error', function (e) { state.server.error = err(e); console.error('USB Share HTTP: ' + e.message); });
  server.listen(PORT, '0.0.0.0', function () {
    state.server.listening = true;
    console.log('USB Share running on http://0.0.0.0:' + PORT);
  });
  // Expose the server state and helpers for local verification.
  module.exports = { server: server, state: state, scanNode: scanNode, range: range, validRel: validRel };
})();
