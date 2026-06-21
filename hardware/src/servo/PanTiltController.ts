/**
 * PanTiltController — drives pan/tilt servos via PCA9685 over I2C.
 * Implementation lands in J6.
 */
export class PanTiltController {
  async init(): Promise<void> {}
  async setPosition(_pan: number, _tilt: number): Promise<void> {}
  async shutdown(): Promise<void> {}
}
