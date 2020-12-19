import { Connection } from './connection';

export class Keymaster {

  private enabled: Connection[] = [];

  public async enable(name: string) {
    if (!this.getConnectionByName(name)) {
      this.createConnection(name);
    }
  }

  private getConnectionByName(name: string) {
    return this.enabled.find(conn => conn.name === name);
  }

  private createConnection(name: string) {
    this.enabled.push(new Connection(name).start());
  }

}
