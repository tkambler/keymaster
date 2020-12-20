import { Client } from 'ssh2';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as _ from 'lodash';
import * as net from 'net';
import delay from 'delay';
import untildify from 'untildify';
import { EventEmitter2 } from 'eventemitter2';
import { getSSHConfig } from './config';
import execa from 'execa';
import { exists } from 'fs-extra';
import Debug from 'debug';

const hookModule = path.resolve(os.homedir(), 'keymaster.js');

/**
 * The `Connection` class represents a (wait for it)..... connection. In this context, a connection
 * may consist of multiple SSH hops (via ProxyJump directives).
 */
export class Connection extends EventEmitter2 {

  /**
   * The name of the SSH config entry that this instance represents.
   */
  public name;

  /**
   * Has this connection been activated?
   */
  public active: boolean = false;

  /**
   * An array containing the various "hops" that make up this connection. If no ProxyJump directives
   * are configured, this array will contain a single entry. Otherwise, entries will exist for each
   * jump.
   */
  private hops: any[];

  private debug;
  private errorCount = 0;

  /**
   * Is the connection in the process of setting up?
   */
  private connecting = false;

  /**
   * Is the connection in the process of tearing itself down?
   */
  private destroying = false;

  /**
   * Has the connection been destroyed?
   */
  private destroyed = false;

  public constructor(name: string) {
    super();
    Object.defineProperties(this, {
      name: {
        value: name,
        iterable: true,
      },
      debug: {
        value: Debug(`keymaster:connection:${name}`),
      },
    });
    this.on('error', this.onError);
    this.debug('Instantiated.');
  }

  /**
   * Activates the connection (if not already active)
   */
  public activate() {
    if (this.active || this.destroyed) {
      return;
    }
    this.debug('Activating.');
    this.active = true;
    this.connect();
    return this;
  }

  /**
   * Tears down the connection.
   */
  public async destroy() {
    if (this.destroying || this.destroyed) {
      return;
    }
    this.destroying = true;
    const hops = [...this.hops].reverse();
    for (const hop of hops) {
      try {
        hop.conn.end();
      } catch(err) {
        this.debug('Error closing hop connection:', {
          hop,
          error: err,
        });
      }
      for (const localForward of hop.localForward) {
        try {
          localForward.server.close();
        } catch(err) {
          this.debug('Error closing localForward server connection:', {
            hop,
            localForward,
            error: err,
          });
        }
      }
    }
    this.destroyed = true;
    this.destroying = false;
  }

  /**
   * Emits a message that will get picked up and printed by the terminal.
   * 
   * @param message
   */
  private broadcast(message: string) {
    this.emit('connection_message', {
      name: this.name,
      message,
    });
  }

  /**
   * If an error occurs throughout any step of the connection, this method gets called. It
   * tears everything down and tries to re-connect.
   * 
   * @param err 
   */
  private onError = async (err) => {
    this.debug('An error has occurred:', {
      err,
    });
    this.errorCount++;
    await this.destroy();
    await delay(this.errorCount * 4000);
    this.connect();
  }

  /**
   * Initiates the connection process.
   */
  private async connect() {
    if (this.connecting || this.destroyed) {
      return;
    }
    this.connecting = true;
    this.broadcast('Connecting.');
    try {
      await this.executeHook();
      const sshConfig = await getSSHConfig();
      this.hops = await this.describeHop(this.name, sshConfig, true);
      await this.createHopStack();
      this.errorCount = 0;
      this.connecting = false;
      this.broadcast('Connected.');
    } catch(err) {
      this.broadcast('Failed to connect.');
      this.connecting = false;
      throw err;
    }
  }

  /**
   * This method loops through each hop in the connection stack (in reverse order), establishes the
   * connection, then moves on to the next one. Each hop in the chain receives a reference to the
   * previous hop, allowing it to tunnel through the upstream connection.
   * 
   * @param hops 
   */
  private async createHopStack() {
    // Since we're establishing a chain of dependent connections here, we need to loop through
    // them in reverse order, since each hop along the way needs the next hop to be available before
    // it can connect.
    const hops = [...this.hops].reverse();
    for (const hop of hops) {
      const idx = hops.indexOf(hop);
      const prevHop = hops[idx - 1];
      const conn = await this.connectHop(hop, prevHop);
      hop.conn = conn;
    }
  }

  /**
   * Establishes an SSH connection to a host and forwards any ports defined via LocalForward
   * directives. This could be better. Errors are being handled in a rather blunt fashion right
   * now.
   * 
   * @param hop 
   * @param upstream 
   */
  private async connectHop(hop, upstream?) {
    return new Promise((resolve, reject) => {
      if (upstream) {
        // We're not establishing a direct SSH connection here. We're first tunneling through
        // this hop's upstream connection.
        this.debug('Connecting to hop via upstream (ProxyJump):', {
          hop,
          upstream: _.omit(upstream, ['conn']),
        });
        this.debug('forwardOut:', {
          host: hop.host,
          port: hop.port,
        });
        upstream.conn.forwardOut('0.0.0.0', null, hop.host, hop.port, (err, stream) => {
          if (err) {
            this.debug('forwardOut error:', {
              host: hop.host,
              port: hop.port,
              error: err,
            });
            this.emit('error', err);
            upstream.conn.end();
            return reject(err);
          }
          stream.on('error', err => {
            upstream.conn.close();
            this.emit('error', err);
          });
          const conn = new Client();
          conn.on('close', () => {
            this.emit('error', new Error('Connection was closed.'));
          });
          conn.on('error', err => {
            this.debug('Hop connection error:', err);
            this.emit('error', err);
            conn.end();
            return reject(err);
          });
          conn.on('ready', () => {
            for (const localForward of hop.localForward) {
              this.debug('localForward:', {
                hop: _.omit(hop, ['localForward']),
                localForward,
              });
              this.broadcast(`Creating tunnel: 127.0.0.1:${localForward.localPort} -> <${upstream.username}@${upstream.host}:${upstream.port} -> ${hop.username}@${hop.host}:${hop.port}> -> ${localForward.remoteHost}:${localForward.remotePort}`);
              localForward.server = net.createServer((from) => {
                conn.forwardOut('127.0.0.1', null, localForward.remoteHost, localForward.remotePort, (err, stream) => {
                  if (err) {
                    this.debug('forwardOut error:', {
                      host: localForward.remoteHost,
                      port: localForward.remotePort,
                      error: err,
                    });
                    this.emit('error', err);
                    return conn.end();
                  }
                  stream.on('error', err => {
                    upstream.conn.close();
                    localForward.server.close();
                    this.emit('error', err);
                  });
                  stream.on('close', () => {
                    this.emit('error', new Error('Upstream forwardOut connection was closed.'));
                    from.end();
                  });
                  stream.pipe(from).pipe(stream);
                });
              }).listen(localForward.localPort, '127.0.0.1');
            }
            return resolve(conn);
          })
          .connect({
            sock: stream,
            username: hop.username,
            privateKey: hop.privateKey,
          });
        });
      } else {
        // We're establishing a direct SSH connection to a host - no upstream connections are involved.
        this.debug('Connecting directly to hop:', hop);
        this.broadcast(`Connecting to: ${hop.username}@${hop.host}:${hop.port}`);
        const conn = new Client();
        conn.on('close', () => {
          this.emit('error', new Error('Connection was closed.'));
        });
        conn.on('error', err => {
          this.debug('Hop connection error:', err);
          conn.end();
          return reject(err);
        });
        conn.on('ready', () => {
          for (const localForward of hop.localForward) {
            this.debug('localForward:', {
              hop: _.omit(hop, ['localForward']),
              localForward,
            });
            this.broadcast(`Creating tunnel: 127.0.0.1:${localForward.localPort} -> <${hop.username}@${hop.host}:${hop.port}> -> ${localForward.remoteHost}:${localForward.remotePort}`);
            localForward.server = net.createServer((from) => {
              conn.forwardOut('127.0.0.1', null, localForward.remoteHost, localForward.remotePort, (err, stream) => {
                if (err) {
                  this.debug('forwardOut error:', {
                    host: localForward.remoteHost,
                    port: localForward.remotePort,
                    error: err,
                  });
                  conn.end();
                }
                stream.on('error', err => {
                  upstream.conn.close();
                  localForward.server.close();
                  this.emit('error', err);
                });
                stream.on('close', () => {
                  this.emit('error', new Error('Upstream forwardOut connection was closed.'));
                  from.end();
                });
                stream.pipe(from).pipe(stream);
              });
            }).listen(localForward.localPort, '127.0.0.1');
          }
          return resolve(conn);
        })
        .connect({
          host: hop.host,
          username: hop.username,
          privateKey: hop.privateKey,
          port: hop.port,
        });
      }
    });
  }

  /**
   * Returns an array of objects describing the hops along the connection route. If no
   * ProxyJump directives are used, the array will contain a single object - an SSH host,
   * presumably with one or more LocalForward directives attached.
   * 
   * @param name - The name of the SSH config entry for which we are requesting information
   * @param sshConfig - A parsed SSH config file
   * @param recurse - If true, include information about upstream (i.e. ProxyJump) connections. Otherwise, just return information about this particular entry.
   * @param stack - An array that contains the various entry(s) that this method will return.
   */
  private async describeHop(name: string, sshConfig, recurse = false, stack = []) {
    this.debug('Fetching description for hop:', name);
    const connConfig = sshConfig.compute(name);
    stack.push({
      host: connConfig.HostName || connConfig.Host,
      port: connConfig.Port || 22,
      username: connConfig.User || os.userInfo().username,
      privateKey: await (async () => {
        if (connConfig.IdentityFile.length) {
          let keyFile = _.last(connConfig.IdentityFile);
          if (keyFile.includes('~')) {
            keyFile = untildify(keyFile);
          } else if (!path.isAbsolute(keyFile)) {
            keyFile = path.resolve(os.homedir(), '.ssh', keyFile);
          }
          return fs.readFile(path.resolve(keyFile));
        } else {
          return fs.readFile(path.resolve(os.homedir(), '.ssh/id_rsa'));
        }
      })(),
      localForward: (() => {
        if (!connConfig.LocalForward) {
          return [];
        }
        return connConfig.LocalForward.map(forward => {
          const parsed = /^(?<localPort>[0-9]+) (?<remoteHost>.+):(?<remotePort>[0-9]+)$/g.exec(forward);
          return {
            localPort: parseInt(parsed.groups.localPort, 10),
            remoteHost: parsed.groups.remoteHost,
            remotePort: parseInt(parsed.groups.remotePort, 10),
          };
        });
      })(),
    });
    if (recurse && connConfig.ProxyJump) {
      await this.describeHop(connConfig.ProxyJump, sshConfig, true, stack);
    }
    return stack;
  }

  /**
   * Called just before the connection is setup. Executes ~/keymaster.js (if it exists). The exit
   * result / status will be printed to the console, but the connection process will continue regardless
   * of what it is.
   */
  private async executeHook() {
    if (!await exists(hookModule)) {
      return;
    }
    return execa('node', [
      hookModule,
    ], {
      shell: true,
      all: true,
    })
      .then((res) => {
        this.broadcast(`Pre-connect hook (~/keymaster.js) ran successfully with exit code: 0 - ${res.all}`);
      })
      .catch(res => {
        this.broadcast(`Pre-connect hook (~/keymaster.js) failed with exit code: 0 - ${res.all}`);
      });
  }

}
