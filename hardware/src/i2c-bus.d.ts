// Ambient declaration for i2c-bus — a Linux-only native module.
// On macOS the dynamic import will throw at runtime; the PCA9685PanTiltController
// catches that error and falls back to ConsolePanTiltController.
declare module 'i2c-bus' {
  interface I2CBus {
    readByte(address: number, command: number): Promise<number>;
    writeByte(address: number, command: number, byte: number): Promise<void>;
    close(): Promise<void>;
  }
  function openPromisified(busNumber: number): Promise<I2CBus>;
}
