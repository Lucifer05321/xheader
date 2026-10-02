import fs from './lib/fs.js';
import system from './lib/system.js';
import exec from './lib/exec.js';
import network from './lib/network.js';
import zip from './lib/zip.js';
import config from './lib/config.js';
import proc from './lib/process.js';
import agent from './lib/agent.js';
import path from 'path';
import fse from 'fs-extra';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Auto-connect from u.yml on import
async function autoInit() {
  const candidates = [
    path.join(process.cwd(), 'u.yml'),
    path.join(process.cwd(), 'u.yaml'),
    path.join(__dirname, 'u.yml'),
    path.join(__dirname, 'u.yaml'),
  ];
  for (const c of candidates) {
    try {
      if (await fse.pathExists(c)) {
        const conf = await config.readYaml(c);
        if (conf && conf.url && !conf.error) {
          agent.connect(conf.url, conf);
          return conf;
        }
      }
    } catch {}
  }
}

// Automatically connect on import if u.yml exists
autoInit();

const xheader = {
  ...fs, ...system, ...exec,
  ...network, ...zip, ...config,
  ...proc, ...agent,
  autoInit,
};

export default xheader;
