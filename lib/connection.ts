import * as os from 'os';
import * as path from 'path';
import * as _ from 'lodash';
import delay from 'delay';
import { EventEmitter2 } from 'eventemitter2';
import execa from 'execa';
import { exists } from 'fs-extra';
import Debug from 'debug';
import byline from 'byline';

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

  private proc;

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
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.proc.kill();
  }

  /**
   * Emits a message that will get picked up and printed by the terminal.
   * 
   * @param message
   */
  private broadcast(message: string) {
    this.debug(message);
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
    await this.executeHook();

    this.proc = execa(await this.getSSHBinary(), [
      this.name,
    ], {
      all: true,
    });

    this.connecting = false;
    this.active = true;
    this.broadcast('Connected.');

    byline(this.proc.all).on('data', data => {
      this.broadcast(data);
    });

    this.proc
      .catch(err => {})
      .then(async () => {
        this.errorCount++;
        this.active = false;
        this.broadcast('Connection closed.');
        if (!this.destroyed) {
          await delay(this.errorCount * 1000);
          this.connect();
        }
      });

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

  /**
   * Returns the absolute path to the user's SSH binary.
   */
  private async getSSHBinary() {
    switch (os.platform()) {
      case 'darwin':
        return '/usr/bin/ssh';
      case 'win32':
        return 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
      default:
        throw new Error(`Unknown platform: ${os.platform()}`);
    }
  }

}
