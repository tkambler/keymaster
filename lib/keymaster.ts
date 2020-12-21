import { Connection } from './connection';
import { Interface } from './interface';
import { EventEmitter2 } from 'eventemitter2';

/**
 * @class Keymaster
 * 
 * The `Keymaster` class represents the application as a whole.
 */
export class Keymaster extends EventEmitter2 {

  /**
   * An array containing all enabled connections
   */
  private enabled: Connection[] = [];

  /**
   * Terminal UI
   */
  private interface: Interface;

  /**
   * Starts the application
   */
  public start() {
    // this.activate('etrials-postgres-production');
    Object.defineProperties(this, {
      interface: {
        value: new Interface(this).start(),
        interable: true,
      },
    });
  }

  /**
   * Activates the SSH config entry with the given name
   * 
   * @param name 
   */
  public async activate(name: string) {
    if (!this.getConnectionByName(name)) {
      this.createConnection(name);
    }
  }

  /**
   * Deactivates the SSH config entry with the given name
   * 
   * @param name 
   */
  public async deactivate(name: string) {
    const conn = this.getConnectionByName(name);
    if (conn) {
      this.destroyConnection(conn);
    }
  }

  /**
   * Returns an array of SSH config entry names that are currently activated
   */
  public getActivatedNames(): string[] {
    return this.enabled.map(conn => conn.name);
  }

  /**
   * Returns the `Connection` instance representing the SSH config entry with
   * given name.
   * 
   * @param name 
   */
  private getConnectionByName(name: string) {
    return this.enabled.find(conn => conn.name === name);
  }

  /**
   * Creates a `Connection` instance representing the SSH config entry with the
   * given name (and activates it).
   * 
   * @param name 
   */
  private createConnection(name: string) {
    this.emit('activating', name);
    const conn = new Connection(name);
    conn.on('connection_message', ({ message, name }) => {
      this.emit('connection_message', {
        name,
        message,
      });
    });
    this.enabled.push(conn);
    conn.activate();
  }

  /**
   * Destroys the specified `Connection` instance and removes it from the array
   * of enabled connections.
   * 
   * @param conn 
   */
  private destroyConnection(conn: Connection) {
    this.emit('deactivating', conn.name);
    conn.destroy();
    this.enabled.splice(this.enabled.indexOf(conn), 1);
  }

}
