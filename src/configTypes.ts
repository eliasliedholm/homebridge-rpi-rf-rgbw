import { PlatformIdentifier, PlatformName } from 'homebridge';

export type RfRGBWPlatformConfig = {
  platform: PlatformName | PlatformIdentifier;
  name?: string;
  gpio?: number;
  repeat?: number;
  devices?: Array<DeviceConfig>;
};

export type DeviceConfig = {
  name?: string;
  on_code?: number;
  off_code?: number;
  color_codes?: Array<number>;
  temperature_color_codes?: Array<number>;
  brigthness_up_code: number;
  brightness_down_code: number;
  brigthness_steps: number;
  color_white_code: number;
  pulseLength?: number;
  protocol?: number;
  codelength?: number;
};