import type { Logger } from 'pino';

export interface PanTiltController {
  readonly name: string;
  init(): Promise<void>;
  /** Move to position in degrees (0–180). Implementations must clamp to physical limits. */
  setPosition(pan: number, tilt: number): Promise<void>;
  getPosition(): { pan: number; tilt: number };
  returnToNeutral(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * ConsolePanTiltController — logs position changes, no hardware required.
 * Default when PAN_TILT=mock (or when PCA9685 module fails to load on macOS).
 */
export class ConsolePanTiltController implements PanTiltController {
  readonly name = 'console';

  private pan = 90;
  private tilt = 90;

  constructor(
    private readonly neutralPan: number,
    private readonly neutralTilt: number,
    private readonly log?: Logger,
  ) {
    this.pan = neutralPan;
    this.tilt = neutralTilt;
  }

  async init(): Promise<void> {
    this.log?.debug({ pan: this.pan, tilt: this.tilt }, '[servo/console] initialised at neutral');
  }

  async setPosition(pan: number, tilt: number): Promise<void> {
    this.pan = pan;
    this.tilt = tilt;
    this.log?.debug({ pan, tilt }, '[servo/console] position');
  }

  getPosition(): { pan: number; tilt: number } {
    return { pan: this.pan, tilt: this.tilt };
  }

  async returnToNeutral(): Promise<void> {
    this.pan = this.neutralPan;
    this.tilt = this.neutralTilt;
    this.log?.debug({ pan: this.pan, tilt: this.tilt }, '[servo/console] returned to neutral');
  }

  async shutdown(): Promise<void> {
    await this.returnToNeutral();
  }
}

/**
 * PCA9685PanTiltController — drives servos via PCA9685 over I2C.
 * Uses the `i2c-bus` npm package (Linux only; fails gracefully on macOS).
 *
 * Servo pulse width mapping (50Hz / 20ms period):
 *   0°  → 1ms pulse → tick 102  (out of 4096 at 50Hz)
 *   180° → 2ms pulse → tick 512
 *   pulse_ticks = (angle / 180) * (512 - 102) + 102
 */
export class PCA9685PanTiltController implements PanTiltController {
  readonly name = 'pca9685';

  private pan: number;
  private tilt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bus: any = null;

  constructor(
    private readonly i2cBusNumber: number,
    private readonly i2cAddress: number,
    private readonly panChannel: number,
    private readonly tiltChannel: number,
    private readonly panMin: number,
    private readonly panMax: number,
    private readonly tiltMin: number,
    private readonly tiltMax: number,
    private readonly neutralPan: number,
    private readonly neutralTilt: number,
    private readonly log: Logger,
    private readonly fallback?: ConsolePanTiltController,
  ) {
    this.pan = neutralPan;
    this.tilt = neutralTilt;
  }

  async init(): Promise<void> {
    try {
      // Dynamic import — will throw on macOS / when i2c-bus is not installed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const i2c = await import('i2c-bus') as any;
      this.bus = await i2c.openPromisified(this.i2cBusNumber);
      await this.setPwmFrequency(50);
      await this.setPosition(this.neutralPan, this.neutralTilt);
      this.log.info({ address: `0x${this.i2cAddress.toString(16)}` }, '[servo/pca9685] initialised');
    } catch (err) {
      this.log.warn({ err }, '[servo/pca9685] i2c-bus unavailable — using console fallback');
      this.bus = null;
      await this.fallback?.init();
    }
  }

  async setPosition(pan: number, tilt: number): Promise<void> {
    const clampedPan = Math.max(this.panMin, Math.min(this.panMax, pan));
    const clampedTilt = Math.max(this.tiltMin, Math.min(this.tiltMax, tilt));

    this.pan = clampedPan;
    this.tilt = clampedTilt;

    if (!this.bus) {
      return this.fallback?.setPosition(clampedPan, clampedTilt);
    }

    await this.setServoAngle(this.panChannel, clampedPan);
    await this.setServoAngle(this.tiltChannel, clampedTilt);
  }

  getPosition(): { pan: number; tilt: number } {
    return { pan: this.pan, tilt: this.tilt };
  }

  async returnToNeutral(): Promise<void> {
    await this.setPosition(this.neutralPan, this.neutralTilt);
  }

  async shutdown(): Promise<void> {
    await this.returnToNeutral();
    if (this.bus) {
      await this.bus.close();
      this.bus = null;
    }
    await this.fallback?.shutdown();
  }

  private angleToPwmTick(angle: number): number {
    // 50Hz PWM: 1ms = tick 102, 2ms = tick 512 (at 4096-step resolution)
    return Math.round((angle / 180) * (512 - 102) + 102);
  }

  private async setServoAngle(channel: number, angle: number): Promise<void> {
    const tick = this.angleToPwmTick(angle);
    // PCA9685 register: LED0_ON_L = 0x06 + channel * 4
    const reg = 0x06 + channel * 4;
    // ON at tick 0, OFF at tick = pulse width
    await this.bus.writeByte(this.i2cAddress, reg, 0);      // ON_L
    await this.bus.writeByte(this.i2cAddress, reg + 1, 0);  // ON_H
    await this.bus.writeByte(this.i2cAddress, reg + 2, tick & 0xff);         // OFF_L
    await this.bus.writeByte(this.i2cAddress, reg + 3, (tick >> 8) & 0x0f); // OFF_H
  }

  private async setPwmFrequency(freqHz: number): Promise<void> {
    // prescale = round(25MHz / (4096 * freq)) - 1
    const prescale = Math.round(25000000 / (4096 * freqHz)) - 1;
    const MODE1 = 0x00;
    const PRESCALE = 0xfe;

    const oldMode = await this.bus.readByte(this.i2cAddress, MODE1) as number;
    const sleepMode = (oldMode & 0x7f) | 0x10;
    await this.bus.writeByte(this.i2cAddress, MODE1, sleepMode);
    await this.bus.writeByte(this.i2cAddress, PRESCALE, prescale);
    await this.bus.writeByte(this.i2cAddress, MODE1, oldMode);
    // Wait for oscillator to stabilise
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await this.bus.writeByte(this.i2cAddress, MODE1, oldMode | 0xa1);
  }
}
