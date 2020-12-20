import SSHConfig from 'ssh-config';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exists } from 'fs-extra';

const configFile = path.resolve(os.homedir(), '.ssh/config');

/**
 * Returns a parsed copy of the user's SSH config file
 */
export async function getSSHConfig() {
  if (!await exists(configFile)) {
    throw new Error(`SSH config file does not exist: ${configFile}`);
  }
  return SSHConfig.parse(await fs.readFile(configFile, 'utf-8'));
}
