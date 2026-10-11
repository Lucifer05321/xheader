import archiver from 'archiver';
import extractZip from 'extract-zip';
import fse from 'fs-extra';
import path from 'path';
import { createWriteStream } from 'fs';

export default {
  zip: async (src, out, ignore = []) => {
    try {
      if (!await fse.pathExists(src)) return { error: true, msg: 'Source path does not exist' };
      await fse.ensureDir(path.dirname(out));
      return new Promise((resolve) => {
        const o = createWriteStream(out);
        const a = archiver('zip', { zlib: { level: 9 } });
        o.on('close', () => resolve({ success: true, size: a.pointer() }));
        o.on('error', (err) => resolve({ error: true, msg: err.message }));
        a.on('error', (err) => resolve({ error: true, msg: err.message }));
        a.pipe(o);
        const s = fse.statSync(src);
        if (s.isDirectory()) {
          a.glob('**/*', { cwd: src, ignore: ignore, dot: true }, { prefix: path.basename(src) });
        } else {
          a.file(src, { name: path.basename(src) });
        }
        a.finalize();
      });
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },

  unzip: async (z, dest) => {
    try {
      if (!await fse.pathExists(z)) return { error: true, msg: 'Zip file does not exist' };
      await fse.ensureDir(dest);
      await extractZip(z, { dir: path.resolve(dest) });
      return { success: true };
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },
};
