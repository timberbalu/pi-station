import { describe, expect, it } from 'vitest';

import { ConsolePanTiltController } from '@pi-station/hardware';

describe('ConsolePanTiltController', () => {
  it('initialises at neutral position', async () => {
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    const pos = controller.getPosition();
    expect(pos.pan).toBe(90);
    expect(pos.tilt).toBe(90);
  });

  it('accepts valid positions', async () => {
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    await controller.setPosition(45, 60);
    const pos = controller.getPosition();
    expect(pos.pan).toBe(45);
    expect(pos.tilt).toBe(60);
  });

  it('accepts boundary positions', async () => {
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    await controller.setPosition(0, 0);
    expect(controller.getPosition()).toEqual({ pan: 0, tilt: 0 });
    await controller.setPosition(180, 180);
    expect(controller.getPosition()).toEqual({ pan: 180, tilt: 180 });
  });

  it('returnToNeutral restores neutral position', async () => {
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    await controller.setPosition(30, 120);
    await controller.returnToNeutral();
    expect(controller.getPosition()).toEqual({ pan: 90, tilt: 90 });
  });

  it('shutdown returns to neutral', async () => {
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    await controller.setPosition(45, 45);
    await controller.shutdown();
    expect(controller.getPosition()).toEqual({ pan: 90, tilt: 90 });
  });

  it('custom neutral position is respected', async () => {
    const controller = new ConsolePanTiltController(70, 80);
    await controller.init();
    expect(controller.getPosition()).toEqual({ pan: 70, tilt: 80 });
    await controller.returnToNeutral();
    expect(controller.getPosition()).toEqual({ pan: 70, tilt: 80 });
  });
});
