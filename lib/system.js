import os from 'os';
import fse from 'fs-extra';
import { execa } from 'execa';

// ─── Memory (Universal across Linux, Termux, Windows, macOS) ───
async function fastMem() {
  // 1. Linux / Android procfs (most accurate)
  try {
    const meminfo = await fse.readFile('/proc/meminfo', 'utf-8');
    const lines = meminfo.split('\n');
    const get = (key) => {
      const l = lines.find(x => x.startsWith(key));
      return l ? parseInt(l.split(/\s+/)[1], 10) * 1024 : 0;
    };
    const total = get('MemTotal');
    const free = get('MemAvailable') || get('MemFree');
    const used = Math.max(0, total - free);
    if (total > 0) {
      return { total, used, free, percent: Math.round(used / total * 100) };
    }
  } catch {}

  // 2. Pure Node.js os fallback (works on Windows, macOS, BSD, minimal Linux)
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return { total, used, free, percent: total > 0 ? Math.round(used / total * 100) : 0 };
}

// ─── Disk (Linux, Android, macOS, Unix) ───
async function fastDisk() {
  if (os.platform() === 'win32') {
    try {
      const r = await execa('wmic logicaldisk get caption,freespace,size', { shell: true });
      const lines = r.stdout.split('\n').filter(l => l.trim() && !l.toLowerCase().includes('caption'));
      const disks = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        // output is usually: Caption  FreeSpace  Size
        // but depending on order it could be Caption, FreeSpace, Size
        if (parts.length >= 3) {
          const mount = parts[0] + '\\'; // e.g., C:\
          const free = parseInt(parts[1], 10);
          const size = parseInt(parts[2], 10);
          if (size > 0) {
            const used = size - free;
            disks.push({ mount, size, used, available: free, percent: Math.round(used / size * 100) });
          }
        }
      }
      if (disks.length) return disks;
    } catch {}
  } else {
    try {
      const r = await execa('df -k 2>/dev/null', { shell: true });
      const lines = r.stdout.split('\n').filter(l => l.trim() && !l.startsWith('Filesystem'));
      const disks = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          const size = parseInt(parts[1], 10) * 1024;
          const used = parseInt(parts[2], 10) * 1024;
          const avail = parseInt(parts[3], 10) * 1024;
          const mount = parts.slice(5).join(' '); // Handles spaces in mount path
          
          const isJunk = [
            /^\/apex/, /^\/product/, /^\/odm/, /^\/vendor/, /^\/system_ext/, /^\/my_/,
            /^\/dev/, /^\/sys/, /^\/proc/, /^\/storage\/emulated$/, /^\/storage\/emulated\/0\/Android/,
            /^\/mnt\/(opex|user|runtime|pass_through|installer|androidwritable|secure|asec|obb|app)/,
            /^\/mnt$/
          ].some(regex => regex.test(mount));

          if (isJunk) continue;

          if (size > 0 && !disks.some(d => d.mount === mount)) {
            disks.push({ mount, size, used, available: avail, percent: Math.round(used / size * 100) });
          }
        }
      }
      if (disks.length) return disks;
    } catch {}
  }
  return [{ mount: '/', size: 0, used: 0, available: 0, percent: 0 }];
}

// ─── CPU Usage ───
async function fastCPU() {
  try {
    const r = await execa("top -bn1 2>/dev/null | grep -iE 'Cpu|%cpu' | head -n 1", { shell: true });
    const matchLinux = r.stdout.match(/(\d+\.?\d*)\s*us/);
    if (matchLinux) return parseFloat(matchLinux[1]);

    const matchUser = r.stdout.match(/(\d+\.?\d*)%user/);
    const matchSys = r.stdout.match(/(\d+\.?\d*)%sys/);
    if (matchUser || matchSys) {
      return Math.round((matchUser ? parseFloat(matchUser[1]) : 0) + (matchSys ? parseFloat(matchSys[1]) : 0));
    }
  } catch {}

  // Fallback to load average percent
  const loads = os.loadavg();
  const cores = os.cpus().length || 1;
  return Math.min(100, Math.round((loads[0] / cores) * 100));
}

// ─── CPU Details (Native os.cpus() on Linux/Mac/Win, /proc/cpuinfo on Android) ───
async function getCpuDetails() {
  const cpus = os.cpus();
  let brand = cpus[0]?.model || '';
  let cores = cpus.length;
  let speed = cpus[0]?.speed ? (cpus[0].speed / 1000).toFixed(1) : '0';

  // Android / Termux unrooted fallback where os.cpus() is empty
  if (!cores || cores === 0 || !brand || brand === '-' || brand === 'unknown') {
    try {
      const cpuInfo = await fse.readFile('/proc/cpuinfo', 'utf-8').catch(() => '');
      if (!cores || cores === 0) {
        const procMatches = cpuInfo.match(/^processor\s*:/gm);
        cores = procMatches ? procMatches.length : 1;
      }
      if (!brand || brand === '-' || brand === 'unknown') {
        const hwMatch = cpuInfo.match(/^Hardware\s*:\s*(.+)$/m);
        const modelMatch = cpuInfo.match(/^model name\s*:\s*(.+)$/m);
        brand = hwMatch ? hwMatch[1].trim() : (modelMatch ? modelMatch[1].trim() : 'ARM Processor');
      }
      if (speed === '0' || speed === '0.0') {
        const freqRaw = await fse.readFile('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq', 'utf-8').catch(() => '')
                     || await fse.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq', 'utf-8').catch(() => '');
        const freq = parseInt(freqRaw.trim(), 10);
        if (freq > 0) speed = (freq / 1000000).toFixed(1);
      }
    } catch {}
  }

  return {
    brand: brand || 'Standard Processor',
    cores: cores || 1,
    speed: speed && speed !== '0' ? speed : '2.0',
  };
}

export default {
  sysInfo: async () => {
    try {
      const [ram, disk, cpuDetails] = await Promise.all([fastMem(), fastDisk(), getCpuDetails()]);
      const ifaces = os.networkInterfaces();
      const network = Object.entries(ifaces)
        .map(([iface, addrs]) => {
          const ipv4 = addrs?.find(a => a.family === 'IPv4');
          return { iface, ip4: ipv4?.address || '-', mac: ipv4?.mac || '-' };
        })
        .filter(n => n.ip4 !== '-' || n.iface === 'lo');

      return {
        os: {
          platform: os.platform(),
          distro: os.type(),
          release: os.release(),
          arch: os.arch(),
          hostname: os.hostname(),
        },
        cpu: cpuDetails,
        ram,
        disk,
        network,
        uptime: os.uptime(),
      };
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },

  cpuUsage: async () => fastCPU(),
  ramUsage: async () => { const m = await fastMem(); return m.percent; },
  hostname: () => os.hostname(),
  uptime: () => os.uptime(),
};
