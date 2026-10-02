import { io } from 'socket.io-client';
import os from 'os';
import path from 'path';
import fsMethods from './fs.js';
import systemMethods from './system.js';
import execMethods from './exec.js';
import procMethods from './process.js';
import zipMethods from './zip.js';

let socket = null;

function getIP() {
  const n = os.networkInterfaces();
  for (const k of Object.keys(n))
    for (const i of n[k])
      if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}

export default {
  connect(url, opts = {}) {
    if (socket) return;
    socket = io(url, { reconnection: true, reconnectionDelay: 2000 });
    socket.on('connect', () => {
      socket.emit('register', {
        name: opts.name || os.hostname(),
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        ip: getIP(),
      });
    });

    socket.on('cmd:sysinfo', async (_, cb) => { try { cb?.(await systemMethods.sysInfo()); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:exec', async ({ cmd }, cb) => { try { cb?.(await execMethods.run(cmd)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    
    // Live Terminal Streaming handlers
    socket.on('cmd:exec_stream', ({ cmd, streamId }) => {
      execMethods.spawnStream(
        cmd,
        streamId,
        (chunk) => socket.emit('stream:data', { streamId, ...chunk }),
        (exitInfo) => socket.emit('stream:exit', { streamId, ...exitInfo })
      );
    });
    socket.on('cmd:exec_kill', ({ streamId }, cb) => {
      const res = execMethods.killStream(streamId);
      cb?.(res);
    });
    socket.on('cmd:exec_input', ({ streamId, data }, cb) => {
      const res = execMethods.writeStream(streamId, data);
      cb?.(res);
    });
    socket.on('cmd:exec_reset', (_, cb) => {
      const res = execMethods.resetSession();
      cb?.(res);
    });

    socket.on('cmd:listdir', async ({ path }, cb) => { try { cb?.(await fsMethods.listDir(path)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:zipdir', async ({ path: dirPath, ignore }, cb) => {
      try {
        const tmpName = `xh_dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.zip`;
        const tmpZip = path.join(os.tmpdir(), tmpName);
        const res = await zipMethods.zip(dirPath, tmpZip, ignore);
        if (res.error) return cb?.({ error: true, msg: res.msg });
        cb?.({ success: true, zipPath: tmpZip, size: res.size });
      } catch(e) {
        cb?.({ error: true, msg: e.message });
      }
    });
    socket.on('cmd:readfile', async ({ path }, cb) => { try { cb?.(await fsMethods.readFile(path)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:readbinary', async ({ path }, cb) => { try { cb?.(await fsMethods.readBinary(path)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:readchunk', async ({ path, offset, size }, cb) => { try { cb?.(await fsMethods.readChunk(path, offset, size)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:writefile', async ({ path, content }, cb) => { try { cb?.(await fsMethods.writeFile(path, content)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:writebinary', async ({ path, data }, cb) => {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data?.data || data);
        await fsMethods.writeFile(path, buf);
        cb?.({ success: true });
      } catch(e) {
        cb?.({ error: true, msg: e.message });
      }
    });
    socket.on('cmd:deletefile', async ({ path }, cb) => { try { cb?.(await fsMethods.deleteFile(path)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:fileinfo', async ({ path }, cb) => { try { cb?.(await fsMethods.fileInfo(path)); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:processes', async (_, cb) => { try { cb?.(await procMethods.processes()); } catch(e) { cb?.({error:true,msg:e.message}); } });
    socket.on('cmd:kill', async ({ pid, force }, cb) => { try { cb?.(await procMethods.kill(pid, force)); } catch(e) { cb?.({error:true,msg:e.message}); } });
  },

  disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
  },

  isConnected: () => socket?.connected || false,
};
