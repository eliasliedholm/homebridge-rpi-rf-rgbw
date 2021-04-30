import {
  API,
  APIEvent,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig
} from 'homebridge';
const python = require('node-calls-python').interpreter; // eslint-disable-line @typescript-eslint/no-var-requires
import process from 'child_process';
import { DeviceConfig, RfRGBWPlatformConfig } from './configTypes';

let hap: HAP;
let Accessory: typeof PlatformAccessory;

const PLUGIN_NAME = 'homebridge-rpi-rf-rgbw';
const PLATFORM_NAME = 'rfRGBW';

// const promise = new Promise((resolve, reject) => resolve(true))
// const python = {
//   call: async function promise(device: any, label: any, code: any, protocol: any, pulselength: any, codelength: any){
//     console.log(device, label, code, protocol, pulselength, codelength)
//   }
// };

type Command = {
  accessory: PlatformAccessory,
  value: CharacteristicValue,
  callback: CharacteristicSetCallback
  characteristic: string, //@todo add types
};

type ToDoItemProps = {
  codes: Array<unknown>,
  state: unknown,
};

class RFRGBWPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly config: RfRGBWPlatformConfig;
  private readonly accessories: Array<PlatformAccessory>;
  private readonly commandQueue: Array<Command>;
  private readonly rfDevice: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private transmitting: boolean;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.config = config as RfRGBWPlatformConfig;
    this.api = api;

    this.accessories = [];
    this.commandQueue = [];
    this.transmitting = false;

    let libpython = config.libpython;

    if (!libpython) {
      let pyconfig = process.execSync('python3-config --libs').toString();
      let index = pyconfig.indexOf('-lpython');
      pyconfig = pyconfig.substr(index + 2);
      index = pyconfig.indexOf(' ');
      libpython = pyconfig.substr(0, index);
    }

    python.fixlink('lib' + libpython + '.so');

    const gpio = config.gpio || 17;
    const repeat = config.repeat || 1;

    const rpiRf = python.importSync('rpi_rf');
    try {
      this.rfDevice = python.createSync(rpiRf, 'RFDevice', gpio, 1, null, repeat, 24);
    } catch (ex) {
      this.log.error('Error starting rpi-rf, please make sure you\'ve followed the ' +
        'installation instructions in this project\'s readme: ' + ex);
      return;
    }
    python.callSync(this.rfDevice, 'enable_tx');



    this.rfDevice = console.log

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching.bind(this));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.setService(accessory);
    this.accessories.push(accessory);
  }

  didFinishLaunching(): void {
    const serials: Array<string> = [];
    if (this.config.devices) {
      this.config.devices.forEach((device: DeviceConfig) => {
        if (!device.name) {
          this.log.error('One of your devices has no name configured. This instance will be skipped.');
        } else if (!device.on_code) {
          this.log.error('One of your devices has no on_code configured. This instance will be skipped.');
        } else if (!device.off_code) {
          this.log.error('One of your devices has no off_code configured. This instance will be skipped.');
        } else {
          this.addAccessory(device);
          serials.push(device.on_code + ':' + device.off_code);
        }
      });
    }

    const badAccessories = this.accessories.filter((cachedAccessory: PlatformAccessory) => {
      return !serials.includes(cachedAccessory.context.serial);
    });
    this.removeAccessories(badAccessories);
  }

  addAccessory(data: DeviceConfig): void {
    this.log('Initializing platform accessory \'' + data.name + '\'...');
    const serial = data.on_code + ':' + data.off_code;

    let accessory = this.accessories.find(cachedAccessory => {
      return cachedAccessory.context.serial == serial;
    });

    if (!accessory) {
      const uuid = hap.uuid.generate(serial);
      accessory = new Accessory(data.name!, uuid);

      accessory.addService(hap.Service.Lightbulb, data.name);

      this.setService(accessory);

      this.api.registerPlatformAccessories('homebridge-rpi-rf-rgbw', 'rfRGBW', [accessory]);

      this.accessories.push(accessory);
    }

    accessory.context = {
      state: {},
      ...data,
    };
    accessory.context.serial = serial;

    const accInfo = accessory.getService(hap.Service.AccessoryInformation);
    if (accInfo) {
      accInfo
        .setCharacteristic(hap.Characteristic.Manufacturer, 'eliasliedholm')
        .setCharacteristic(hap.Characteristic.Model, 'rpi-rf')
        .setCharacteristic(hap.Characteristic.SerialNumber, accessory.context.serial);
    }
  }

  removeAccessories(accessories: Array<PlatformAccessory>): void {
    accessories.forEach((accessory: PlatformAccessory) => {
      this.log(accessory.context.name + ' is removed from Homebridge.');
      this.api.unregisterPlatformAccessories('homebridge-rpi-rf-rgbw', 'rfRGBW', [accessory]);
      this.accessories.splice(this.accessories.indexOf(accessory), 1);
    });
  }

  setService(accessory: PlatformAccessory): void {
    const service = accessory.getService(hap.Service.Lightbulb);
    if (service) {
      service
        .getCharacteristic(hap.Characteristic.On)
        .on('set', this.setPowerState.bind(this, accessory));

      service
        .addCharacteristic(hap.Characteristic.Brightness)
        .on('set', this.setBrightnessState.bind(this, accessory));

      service
        .addCharacteristic(hap.Characteristic.Hue)
        .on('set', this.setHueState.bind(this, accessory));

      service
        .addCharacteristic(hap.Characteristic.Saturation)
        .on('set', this.setSaturationState.bind(this, accessory));

      service
        .addCharacteristic(hap.Characteristic.ColorTemperature)
        .on('set', this.setTemperatureState.bind(this, accessory));
    }

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log(accessory.displayName, 'identify requested!');
    });
  }

  setPowerState(accessory: PlatformAccessory, value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.commandQueue.push({
      'accessory': accessory,
      'value': value,
      'characteristic': 'power',
      'callback': callback
    });
    if (!this.transmitting) {
      this.transmitting = true;
      this.nextCommand.bind(this)();
    }
  }

  setBrightnessState(accessory: PlatformAccessory, value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.commandQueue.push({
      'accessory': accessory,
      'value': value,
      'characteristic': 'brightness',
      'callback': callback
    });
    if (!this.transmitting) {
      this.transmitting = true;
      this.nextCommand.bind(this)();
    }
  }

  setHueState(accessory: PlatformAccessory, value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.commandQueue.push({
      'accessory': accessory,
      'value': value,
      'characteristic': 'hue',
      'callback': callback
    });
    if (!this.transmitting) {
      this.transmitting = true;
      this.nextCommand.bind(this)();
    }
  }

  setSaturationState(accessory: PlatformAccessory, value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.commandQueue.push({
      'accessory': accessory,
      'value': value,
      'characteristic': 'saturation',
      'callback': callback
    });
    if (!this.transmitting) {
      this.transmitting = true;
      this.nextCommand.bind(this)();
    }
  }

  setTemperatureState(accessory: PlatformAccessory, value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.commandQueue.push({
      'accessory': accessory,
      'value': value,
      'characteristic': 'temperature',
      'callback': callback
    });
    if (!this.transmitting) {
      this.transmitting = true;
      this.nextCommand.bind(this)();
    }
  }

  nextCommand(): void {
    const todoItem = this.commandQueue.shift();
    if (!todoItem) {
      return;
    }

    const {codes, state} = getCode(todoItem);

    codes.forEach((code: unknown, i: number) => {
      python.call(this.rfDevice, 'tx_code', code, todoItem.accessory.context.protocol,
        todoItem.accessory.context.pulselength, todoItem.accessory.context.codelength)
        .then((): void => {
          this.log.debug(todoItem.accessory.context.name + ' is turned ' + (todoItem.value ? 'on.' : 'off.'));
          Object.assign(todoItem.accessory.context.state, state);

          if (i + 1 === codes.length) {
            if (this.commandQueue.length > 0) {
              this.nextCommand.bind(this)();
            } else {
              this.transmitting = false;
            }
            todoItem.callback();
          }
        })
        .catch((error: Error) => {
          // @todo update error message
          this.log('Failed to turn ' + (todoItem.value ? 'on ' : 'off ') + todoItem.accessory.context.name);
          this.log;
        });
    });

    if (codes.length === 0) {
      this.transmitting = false,
      todoItem.callback();
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getCode = (todoItem: any): ToDoItemProps => {
  const codes = [];
  let state = {};

  if (todoItem.characteristic === 'power') {
    codes.push(todoItem.value ? todoItem.accessory.context.on_code : todoItem.accessory.context.off_code);
    state = { power: todoItem.value };
  } else if (todoItem.characteristic === 'hue') {
    const step = 360 / todoItem.accessory.context.color_codes.length;
    const index = Math.floor(todoItem.value / step);
    codes.push(todoItem.accessory.context.color_codes[index]);
  } else if (todoItem.characteristic === 'saturation') {
    if(todoItem.value <= 50) {
      codes.push(todoItem.accessory.context.color_white_code);
    }
  } else if (todoItem.characteristic === 'brightness') {
    const steps =  todoItem.accessory.context.brightness_steps;
    const step = 100 / steps;
    const repeat = Math.floor(todoItem.value / step);

    for(let i = 0; i < steps; i++) {
      codes.push(todoItem.accessory.context.brightness_down_code);
    }

    for(let i = 0; i < repeat; i++) {
      codes.push(todoItem.accessory.context.brightness_up_code);
    }
  }

  return {
    codes,
    state
  };
};

export = (api: API): void => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RFRGBWPlatform);
};
