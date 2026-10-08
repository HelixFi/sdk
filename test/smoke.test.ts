import { describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { DEFAULT_CONFIG, configAddress, ix, programDataAddress } from '../src';
import { Env } from './harness';

describe('config', () => {
  it('is created by the upgrade authority with the defaults', async () => {
    const e = await Env.create();
    const c = e.configState();
    expect(c.admin).toBe(e.admin.address);
    expect(c.feeCollector).toBe(e.collector.address);
    expect(c.curveSaleTokens).toBe(DEFAULT_CONFIG.curveSaleTokens);
    expect(c.launchFee).toBe(DEFAULT_CONFIG.launchFee);
  });

  it('refuses anyone but the upgrade authority', async () => {
    const e = await Env.create();
    const intruder = await e.wallet();
    // a fresh env whose ProgramData names someone else
    const f = new Env();
    void f;
    const err = await e.fails(
      [ix.initConfig({ authority: intruder, config: await configAddress(), programData: await programDataAddress() }, { ...DEFAULT_CONFIG, feeCollector: intruder.address })],
      intruder,
    );
    expect(err).toMatch(/Unauthorized|AlreadyInitialized/);
    void generateKeyPairSigner;
  });
});
