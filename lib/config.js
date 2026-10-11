import fse from 'fs-extra';
import path from 'path';

export default {
  readJSON: (p) => fse.readJSON(p).catch(e => ({ error: true, msg: e.message })),

  writeJSON: async (p, d) => {
    await fse.ensureDir(path.dirname(p));
    await fse.writeJSON(p, d, { spaces: 2 });
    return { success: true };
  },

  readEnv: async (p) => {
    const c = await fse.readFile(p, 'utf-8');
    const r = {};
    for (const l of c.split('\n')) {
      const t = l.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      let v = t.slice(i + 1).trim();
      if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) v = v.slice(1, -1);
      r[t.slice(0, i).trim()] = v;
    }
    return r;
  },

  writeEnv: async (p, d) => {
    await fse.ensureDir(path.dirname(p));
    await fse.writeFile(p, Object.entries(d).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    return { success: true };
  },

  // ─── Lightweight, Zero-Dependency YAML Parser & Serializer ───
  readYaml: async (p) => {
    try {
      if (!await fse.pathExists(p)) return { error: true, msg: 'File does not exist' };
      const c = await fse.readFile(p, 'utf-8');
      const r = {};
      for (const l of c.split('\n')) {
        const t = l.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf(':');
        if (i === -1) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        } else if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (!isNaN(Number(v)) && v !== '') v = Number(v);
        r[k] = v;
      }
      return r;
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },

  writeYaml: async (p, d) => {
    try {
      await fse.ensureDir(path.dirname(p));
      const lines = Object.entries(d).map(([k, v]) => {
        if (typeof v === 'string' && (v.includes(':') || v.includes('#') || v.includes(' '))) {
          return `${k}: "${v}"`;
        }
        return `${k}: ${v}`;
      });
      await fse.writeFile(p, lines.join('\n') + '\n');
      return { success: true };
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },
};
