import fse from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

async function safe(fn) {
  try { return await fn(); }
  catch (e) { return { error: true, msg: e.message }; }
}

export default {
  readFile: (p) => safe(() => fse.readFile(p, 'utf-8')),
  readBinary: (p) => safe(() => fse.readFile(p)),

  writeFile: (p, c) => safe(async () => {
    await fse.ensureDir(path.dirname(p));
    await fse.writeFile(p, c, typeof c === 'string' ? 'utf-8' : undefined);
    return { success: true };
  }),

  appendFile: (p, c) => safe(async () => {
    await fse.ensureDir(path.dirname(p));
    await fse.appendFile(p, c, 'utf-8');
    return { success: true };
  }),

  editFile: (p, old, rep) => safe(async () => {
    const c = await fse.readFile(p, 'utf-8');
    await fse.writeFile(p, c.replaceAll(old, rep), 'utf-8');
    return { success: true };
  }),

  deleteFile: (p) => safe(() => fse.remove(p).then(() => ({ success: true }))),
  copyFile: (s, d) => safe(() => fse.copy(s, d).then(() => ({ success: true }))),
  moveFile: (s, d) => safe(() => fse.move(s, d).then(() => ({ success: true }))),
  exists: (p) => fse.pathExists(p),
  mkdir: (p) => safe(() => fse.ensureDir(p).then(() => ({ success: true }))),
  chmod: (p, m) => safe(() => fse.chmod(p, m).then(() => ({ success: true }))),

  listDir: (p) => safe(async () => {
    const items = await fse.readdir(p, { withFileTypes: true });
    const out = [];
    for (const i of items) {
      const fp = path.join(p, i.name);
      const s = await fse.stat(fp).catch(() => null);
      // Follow symlinks so symlinked directories show as 'dir'
      const isDirectory = s ? s.isDirectory() : i.isDirectory();
      out.push({
        name: i.name,
        path: fp,
        type: isDirectory ? 'dir' : 'file',
        isSymlink: i.isSymbolicLink(),
        size: s?.size || 0,
        modified: s?.mtime,
      });
    }
    return out;
  }),

  search: (dir, pat) => safe(() => glob(pat, { cwd: dir, absolute: true })),

  fileInfo: (p) => safe(async () => {
    const s = await fse.stat(p);
    return {
      name: path.basename(p),
      ext: path.extname(p),
      type: s.isDirectory() ? 'dir' : 'file',
      size: s.size,
      modified: s.mtime,
    };
  }),

  readChunk: async (p, offset, size) => {
    try {
      const fd = await fse.open(p, 'r');
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await fse.read(fd, buffer, 0, size, offset);
      await fse.close(fd);
      return { chunk: bytesRead < size ? buffer.slice(0, bytesRead) : buffer };
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },

  tree: async function t(dir, depth = 3, lv = 0) {
    try {
      if (lv >= depth) return [];
      const items = await fse.readdir(dir, { withFileTypes: true });
      const r = [];
      for (const i of items) {
        if (i.name.startsWith('.')) continue;
        const fp = path.join(dir, i.name);
        const s = await fse.stat(fp).catch(() => null);
        const isDirectory = s ? s.isDirectory() : i.isDirectory();
        const n = { name: i.name, type: isDirectory ? 'dir' : 'file' };
        if (isDirectory) n.children = await t(fp, depth, lv + 1);
        r.push(n);
      }
      return r;
    } catch (e) { return { error: true, msg: e.message }; }
  },
};
