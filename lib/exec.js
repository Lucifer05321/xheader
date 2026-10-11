import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fse from 'fs-extra';

const activeProcesses = new Map();
const initialProjectRoot = process.cwd();
let sessionCwd = initialProjectRoot;
let prevCwd = sessionCwd;

function getShell() {
  if (os.platform() === 'win32') {
    return { shell: process.env.COMSPEC || 'cmd.exe', flag: '/s /c' };
  }
  return { shell: process.env.SHELL || '/bin/sh', flag: '-c' };
}

function isStandaloneCd(trimmed) {
  if (trimmed === 'cd') return true;
  if (/[;&|]/.test(trimmed)) return false;
  return /^cd(\s+.*)?$/.test(trimmed);
}

function resolveCd(target) {
  const clean = (target || '').trim().replace(/^["']|["']$/g, '');
  if (!clean || clean === '~') {
    return { target: clean, dest: process.env.HOME || os.homedir() || process.cwd() };
  }
  if (clean === '-') {
    return { target: clean, dest: prevCwd };
  }
  if (clean.startsWith('~/')) {
    return { target: clean, dest: path.join(process.env.HOME || os.homedir() || process.cwd(), clean.slice(2)) };
  }
  return { target: clean, dest: path.resolve(sessionCwd, clean) };
}

export default {
  getCwd: () => sessionCwd,
  setCwd: (p) => { sessionCwd = p; },

  // One-shot execution with persistent directory tracking
  run: async (cmd, opts = {}) => {
    const trimmed = cmd.trim();

    // Standalone cd
    if (isStandaloneCd(trimmed)) {
      const match = trimmed.match(/^cd(?:\s+(.*))?$/);
      const { target, dest } = resolveCd(match ? match[1] : '');
      try {
        const stat = fse.statSync(dest);
        if (!stat.isDirectory()) {
          return { stdout: '', stderr: `sh: cd: ${target}: Not a directory\n`, code: 1, cwd: sessionCwd };
        }
        prevCwd = sessionCwd;
        sessionCwd = dest;
        const out = target === '-' ? `${dest}\n` : '';
        return { stdout: out, stderr: '', code: 0, cwd: sessionCwd };
      } catch (e) {
        return { stdout: '', stderr: `sh: cd: ${target}: No such file or directory\n`, code: 1, cwd: sessionCwd };
      }
    }

    return new Promise((resolve) => {
      const { shell, flag } = getShell();
      const effectiveCwd = opts.cwd || sessionCwd;
      const isWin = os.platform() === 'win32';
      const tmpId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const cwdFile = path.join(os.tmpdir(), `.xh_cwd_${tmpId}`);
      const wrappedCmd = isWin
        ? cmd
        : `${cmd}\n__XH_EC__=$?\npwd -P > "${cwdFile}" 2>/dev/null\nexit $__XH_EC__`;

      const proc = spawn(shell, [flag, wrappedCmd], { cwd: effectiveCwd });
      let stdout = '', stderr = '';

      const timeoutMs = opts.timeout || 30000;
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        try { if (fse.existsSync(cwdFile)) fse.removeSync(cwdFile); } catch {}
        resolve({ error: true, stderr: `Command timed out after ${timeoutMs / 1000}s`, code: 124, cwd: sessionCwd });
      }, timeoutMs);

      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());

      proc.on('close', code => {
        clearTimeout(timer);
        try {
          if (fse.existsSync(cwdFile)) {
            const recordedCwd = fse.readFileSync(cwdFile, 'utf8').trim();
            fse.removeSync(cwdFile);
            if (recordedCwd && fse.existsSync(recordedCwd)) {
              prevCwd = sessionCwd;
              sessionCwd = recordedCwd;
            }
          }
        } catch {}
        resolve({ stdout, stderr, code, cwd: sessionCwd });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        try { if (fse.existsSync(cwdFile)) fse.removeSync(cwdFile); } catch {}
        resolve({ error: true, stderr: err.message, code: 1, cwd: sessionCwd });
      });
    });
  },

  // Live streaming execution with persistent CWD support
  spawnStream: (cmd, streamId, onData, onExit, opts = {}) => {
    const trimmed = cmd.trim();

    // 1. Standalone "cd" command handler (instant & 100% reliable)
    if (isStandaloneCd(trimmed)) {
      const match = trimmed.match(/^cd(?:\s+(.*))?$/);
      const { target, dest } = resolveCd(match ? match[1] : '');
      try {
        const stat = fse.statSync(dest);
        if (!stat.isDirectory()) {
          onData({ type: 'stderr', data: `sh: cd: ${target}: Not a directory\n` });
          onExit({ code: 1, cwd: sessionCwd });
          return;
        }
        prevCwd = sessionCwd;
        sessionCwd = dest;
        if (target === '-') {
          onData({ type: 'stdout', data: `${dest}\n` });
        }
        onExit({ code: 0, cwd: sessionCwd });
        return;
      } catch (e) {
        onData({ type: 'stderr', data: `sh: cd: ${target}: No such file or directory\n` });
        onExit({ code: 1, cwd: sessionCwd });
        return;
      }
    }

    // 2. All other commands: stream output cleanly and capture directory changes
    const { shell, flag } = getShell();
    const effectiveCwd = opts.cwd || sessionCwd;
    const isWin = os.platform() === 'win32';
    const cwdFile = path.join(os.tmpdir(), `.xh_cwd_${streamId}`);
    const wrappedCmd = isWin
      ? cmd
      : `${cmd}\n__XH_EC__=$?\npwd -P > "${cwdFile}" 2>/dev/null\nexit $__XH_EC__`;

    const proc = spawn(shell, [flag, wrappedCmd], { cwd: effectiveCwd });
    activeProcesses.set(streamId, { proc, cwdFile });

    proc.stdout.on('data', d => onData({ type: 'stdout', data: d.toString() }));
    proc.stderr.on('data', d => onData({ type: 'stderr', data: d.toString() }));

    proc.on('close', code => {
      activeProcesses.delete(streamId);
      try {
        if (fse.existsSync(cwdFile)) {
          const recordedCwd = fse.readFileSync(cwdFile, 'utf8').trim();
          fse.removeSync(cwdFile);
          if (recordedCwd && fse.existsSync(recordedCwd)) {
            prevCwd = sessionCwd;
            sessionCwd = recordedCwd;
          }
        }
      } catch {}
      onExit({ code, cwd: sessionCwd });
    });

    proc.on('error', err => {
      activeProcesses.delete(streamId);
      try { if (fse.existsSync(cwdFile)) fse.removeSync(cwdFile); } catch {}
      onExit({ error: true, msg: err.message, cwd: sessionCwd });
    });
  },

  // Send signal / kill running process (Ctrl+C)
  killStream: (streamId) => {
    const item = activeProcesses.get(streamId);
    if (item) {
      const proc = item.proc || item;
      try {
        proc.kill('SIGINT');
        setTimeout(() => {
          try {
            if (activeProcesses.has(streamId)) proc.kill('SIGKILL');
          } catch {}
        }, 1500);
      } catch (e) {
        try { proc.kill('SIGKILL'); } catch {}
      }
      if (item.cwdFile) {
        try { if (fse.existsSync(item.cwdFile)) fse.removeSync(item.cwdFile); } catch {}
      }
      activeProcesses.delete(streamId);
      return { success: true };
    }
    return { error: true, msg: 'Process not found' };
  },

  // Send input to running process stdin
  writeStream: (streamId, data) => {
    const item = activeProcesses.get(streamId);
    const proc = item?.proc || item;
    if (proc && proc.stdin) {
      try {
        proc.stdin.write(data);
        return { success: true };
      } catch (e) {
        return { error: true, msg: e.message };
      }
    }
    return { error: true, msg: 'Process not found' };
  },

  // Reset session directory and terminate active processes
  resetSession: () => {
    for (const [_, item] of activeProcesses.entries()) {
      try {
        const proc = item?.proc || item;
        proc.kill('SIGKILL');
      } catch {}
      if (item?.cwdFile) {
        try { if (fse.existsSync(item.cwdFile)) fse.removeSync(item.cwdFile); } catch {}
      }
    }
    activeProcesses.clear();
    sessionCwd = initialProjectRoot;
    prevCwd = sessionCwd;
    return { success: true, cwd: sessionCwd };
  }
};
