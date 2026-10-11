import { execa } from 'execa';
import os from 'os';

export default {
  processes: async () => {
    // 1. Linux / Termux standard procps
    try {
      const r = await execa('ps -eo pid,%cpu,%mem,args --no-header 2>/dev/null', { shell: true });
      if (r.stdout && r.stdout.trim()) {
        return r.stdout.split('\n').filter(l => l.trim()).map(l => {
          const p = l.trim().split(/\s+/);
          return { pid: +p[0], cpu: +p[1] || 0, mem: +p[2] || 0, cmd: p.slice(3).join(' ') };
        });
      }
    } catch {}

    // 2. POSIX / macOS / Alpine / BusyBox fallback
    try {
      const r = await execa('ps aux 2>/dev/null', { shell: true });
      const lines = r.stdout.split('\n').filter(l => l.trim() && !l.startsWith('USER'));
      return lines.map(l => {
        const p = l.trim().split(/\s+/);
        return { user: p[0], pid: +p[1], cpu: +p[2] || 0, mem: +p[3] || 0, cmd: p.slice(10).join(' ') };
      });
    } catch {}

    // 3. Windows fallback
    if (os.platform() === 'win32') {
      try {
        const r = await execa('tasklist /fo csv /nh', { shell: true });
        return r.stdout.split('\n').filter(l => l.trim()).map(l => {
          const p = l.replace(/"/g, '').split(',');
          return { pid: +p[1], cpu: 0, mem: 0, cmd: p[0] };
        });
      } catch {}
    }

    return [];
  },

  kill: async (pid, force = false) => {
    try {
      const p = parseInt(pid, 10);
      if (!p || isNaN(p) || p <= 0) return { error: true, msg: 'Invalid PID' };
      const cmd = os.platform() === 'win32'
        ? `taskkill /PID ${p}${force ? ' /F' : ''}`
        : `kill ${force ? '-9 ' : ''}${p}`;
      await execa(cmd, { shell: true });
      return { success: true };
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },

  isRunning: async (name) => {
    try {
      const r = await execa(`pgrep -f "${name.replace(/"/g, '\\"')}" 2>/dev/null`, { shell: true });
      if (r.stdout.trim().length > 0) return true;
    } catch {}

    // Fallback: check ps list in JS
    try {
      const r = await execa('ps aux 2>/dev/null || ps', { shell: true });
      return r.stdout.toLowerCase().includes(name.toLowerCase());
    } catch {
      return false;
    }
  },
};
