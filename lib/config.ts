import SSHConfig from 'ssh-config';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as _ from 'lodash';
import { exists, readJson } from 'fs-extra';
import untildify from 'untildify';

const globalConfigFile = path.resolve(os.homedir(), 'keymaster.conf.json');
const configFile = path.resolve(os.homedir(), '.ssh/config');

const globalDefaults = {
  ssh: {
    path: (() => {
      switch (os.platform()) {
        case 'darwin':
          return '/usr/bin/ssh';
        case 'win32':
          return 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
        default:
          throw new Error(`Unknown platform: ${os.platform()}`);
      }
    })(),
  },
  hook: {
    preconnect: path.resolve(os.homedir(), 'keymaster.js'),
  },
};

/**
 * Returns a parsed copy of the user's SSH config file
 */
export async function getSSHConfig() {
  if (!await exists(configFile)) {
    throw new Error(`SSH config file does not exist: ${configFile}`);
  }
  return SSHConfig.parse(await fs.readFile(configFile, 'utf-8'));
}

export async function getGlobalConfig() {
  if (!await exists(globalConfigFile)) {
    return _.cloneDeep(globalDefaults);
  }
  const conf = await readJson(globalConfigFile, 'utf-8');
  const result = _.cloneDeep(
    _.merge({}, conf, globalDefaults)
  );
  result.hook.preconnect = untildify(result.hook.preconnect);
  return result;
}
