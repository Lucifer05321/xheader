import axios from 'axios';
import fse from 'fs-extra';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

export default {
  fetch: (url, o = {}) => axios.get(url, { headers: o.headers, timeout: o.timeout || 30000 }).then(r => r.data).catch(e => ({ error: true, msg: e.message })),
  post: (url, data, o = {}) => axios.post(url, data, { headers: o.headers, timeout: o.timeout || 30000 }).then(r => r.data).catch(e => ({ error: true, msg: e.message })),

  downloadFile: async (url, saveTo) => {
    try {
      await fse.ensureDir(path.dirname(saveTo));
      const r = await axios.get(url, { responseType: 'stream', timeout: 60000 });
      await pipeline(r.data, createWriteStream(saveTo));
      return { success: true, path: saveTo };
    } catch (e) {
      return { error: true, msg: e.message };
    }
  },

  myIP: () => axios.get('https://api.ipify.org?format=json', { timeout: 5000 }).then(r => r.data.ip).catch(() => null),
  isOnline: () => axios.head('https://google.com', { timeout: 5000 }).then(() => true).catch(() => false),
};
