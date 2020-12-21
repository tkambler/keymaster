import * as os from 'os';
import * as path from 'path';
import * as _ from 'lodash';
import delay from 'delay';
import { EventEmitter2 } from 'eventemitter2';
import execa from 'execa';
import { exists } from 'fs-extra';
import Debug from 'debug';
import byline from 'byline';

/**
 * The `Connection` class represents a (wait for it)..... connection. In this context, a connection
 * may consist of multiple SSH hops (via ProxyJump directives).
 */
export class Connection extends EventEmitter2 {

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

  public constructor(public name: string, private config) {
    super();
    Object.defineProperties(this, {
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

    this.proc = execa(this.config.ssh.path, [
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
    if (!await exists(this.config.hook.preconnect)) {
      this.broadcast('No pre-connection hook has been configured.');
      return;
    }
    const hookProc = execa('node', [
      this.config.hook.preconnect,
    ], {
      shell: true,
      all: true,
    });
    byline(hookProc.all).on('data', data => {
      this.broadcast(data.toString('utf-8'));
    });
    try {
      await hookProc;
      this.broadcast(`Pre-connect hook (~/keymaster.js) ran successfully with exit code: 0`);
    } catch(err) {
      this.broadcast(`Pre-connect hook (~/keymaster.js) failed with exit code: ${err.exitCode}`);
    }
  }

}
