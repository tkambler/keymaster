import { Client } from 'ssh2';
import SSHConfig from 'ssh-config';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import untildify from 'untildify';
import * as net from 'net';
import { EventEmitter2 } from 'eventemitter2';

export class Connection extends EventEmitter2 {

  public name;

  public constructor(name: string) {
    super();
    Object.defineProperties(this, {
      name: {
        value: name,
        iterable: true,
      },
    });
  }

  public start() {
    this.connect();
    return this;
  }

  private async getSSHConfig() {
    return SSHConfig.parse(await fs.readFile(path.resolve(os.homedir(), '.ssh/config'), 'utf-8'));
  }

  private async connect() {

    const [ connSettings, connOptions ] = await this.getConnectionSettings(this.name);

    console.log(JSON.stringify({
      connSettings,
      connOptions,
    }, null, 2));

    const conn = new Client();
  
    conn
      .on('ready', () => {

        for (const localForward of (connSettings as any).localForward) {
          net.createServer((from) => {
  
            conn.forwardOut('127.0.0.1', null, localForward.remoteHost, localForward.remotePort, (err, stream) => {
    
              if (err) {
                throw err;
              }
      
              console.log('forwarding out');
      
              stream.on('close', () => {
                from.end();
              });
    
              stream.pipe(from).pipe(stream);
      
            });
      
          }).listen(localForward.localPort, '127.0.0.1');
        }
    
      })
      .connect({
        host: (connSettings as any).host,
        username: (connSettings as any).username,
        privateKey: (connSettings as any).privateKey,
      });

  }

  private async getConnectionSettings(name: string) {

    const sshConfig = await this.getSSHConfig();
    const connConfig = sshConfig.compute(name);
  
    return [await this.getConnectionEntry(name), await (async () => {

      if (connConfig.ProxyJump) {
        const connConfig = sshConfig.compute(name);
        return {
          jump: await this.getConnectionEntry(connConfig.ProxyJump),
        };
      } else {
        return {};
      }

    })()];
  
  }

  private async getConnectionEntry(name: string) {

    const sshConfig = await this.getSSHConfig();
    const connConfig = sshConfig.compute(name);
    // console.log(connConfig);

    return {
      host: connConfig.Hostname || connConfig.Host,
      port: connConfig.Port,
      username: connConfig.User,
      privateKey: await (async () => {
        if (connConfig.IdentityFile.length) {
          if (connConfig.IdentityFile.length > 1) {
            throw new Error(`Connection to ${name} - I don't know what to do with more than one identity file: ${connConfig.IdentityFile.join(', ')}`);
          } else {
            let keyFile = connConfig.IdentityFile[0];
            if (keyFile.includes('~')) {
              keyFile = untildify(keyFile);
            } else if (!path.isAbsolute(keyFile)) {
              keyFile = path.resolve(os.homedir(), '.ssh', keyFile);
            }
            return fs.readFile(path.resolve(keyFile), 'utf-8');
          }
        } else {
          return fs.readFile(path.resolve(os.homedir(), '.ssh/id_rsa'), 'utf-8');
        }
      })(),
      localForward: (() => {
        if (!connConfig.LocalForward) {
          return;
        }
        return connConfig.LocalForward.map(forward => {
          const parsed = /^(?<localPort>[0-9]+) (?<remoteHost>.+):(?<remotePort>[0-9]+)$/g.exec(forward);
          return {
            localPort: parseInt(parsed.groups.localPort, 10),
            remoteHost: parsed.groups.remoteHost,
            remotePort: parseInt(parsed.groups.remotePort, 10),
          }
        });
      })(),
    };

  }

}
