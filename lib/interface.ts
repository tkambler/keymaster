import { Keymaster } from './keymaster';
import blessed from 'blessed';
import { getSSHConfig } from './config';

/**
 * The `Interface` class coordinates interaction with the user via the terminal.
 *
 * @class Interface
 */
export class Interface {

  private screen;
  private left;
  private right;
  private list;

  public constructor(private keymaster: Keymaster) {}

  public async start() {

    this.initLayout();
    await this.updateConnectionsList();

    this.list.on('select', e => {
      const content = this.list.getItem(this.list.selected).content;
      const tmp = content.split(']');
      const active = tmp[0].includes('X');
      const name = tmp[1].trim();
      if (active) {
        this.keymaster.deactivate(name);
      } else {
        this.keymaster.activate(name);
      }
    });

    this.left.append(this.list);
    this.list.focus();

    this.screen.render();

    this.keymaster.on('activating', async (name: string) => {
      await this.updateConnectionsList();
      this.logLines(`Activated: ${name}`);
    });

    this.keymaster.on('deactivating', async (name: string) => {
      await this.updateConnectionsList();
      this.logLines(`Deactivated: ${name}`);
    });

    this.keymaster.on('connection_message', ({ name, message }) => {
      this.logLines(`${name}: ${message}`);
    });

    return this;

  }

  private async updateConnectionsList() {
    const config = await getSSHConfig();
    const active = this.keymaster.getActivatedNames();
    const items = config
      .filter(row => row.param === 'Host')
      .filter(row => {
        const localForward = (row.config || []).find(conf => {
          return conf.param && conf.param.includes('LocalForward');
        });
        if (!localForward) {
          return false;
        }
        const ignore = (row.config || []).find(conf => {
          return conf.param && conf.param.includes('KeymasterIgnore');
        });
        if (!ignore) {
          return true;
        }
        if (ignore.value !== 'yes') {
          return true;
        }
      })
      .map(row => ({
        name: row.value,
        active: active.indexOf(row.value) > -1,
      }))
      .map(row => row.active ? `[X] ${row.name}` : `[ ] ${row.name}`);
    this.list.setItems(items);
    this.screen.render();
  }

  private initLayout() {

    this.screen = blessed.screen();

    this.screen.key(['escape', 'q', 'C-c'], function (ch, key) {
      return process.exit(0);
    });

    this.left = blessed.box({
      top: 0,
      left: 0,
      width: '20%',
      height: '100%',
      content: '',
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        bg: 'magenta',
        border: {
          fg: '#f0f0f0'
        },
        hover: {
          bg: 'green',
        }
      }
    });

    this.right = blessed.box({
      top: 0,
      right: 0,
      width: '80%',
      height: '100%',
      content: 'I am the Keymaster.',
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        border: {
          fg: '#f0f0f0'
        },
      }
    });

    this.screen.append(this.left);
    this.screen.append(this.right);

    this.list = blessed.list({
      mouse: true,
      interactive: true,
      invertSelected: true,
      keys: true,
      style: {
        item: {
          fg: 'red',
        },
        selected: {
          bg: 'green',
          fg: 'black',
        },
      },
      items: [],
    });

  }

  private logLines(message: string | string[]): void {
    if (Array.isArray(message)) {
      this.right.insertBottom(message);
    } else {
      this.right.insertBottom([message]);
    }
    this.screen.render();    
  }

}
