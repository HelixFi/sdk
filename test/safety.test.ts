import { describe, expect, it } from 'vitest';
import { lamports } from '@solana/kit';
import { DEFAULT_CONFIG, NO_RULES, PAUSE, holdingAddress, ix, launchAddress, poolAddress } from '../src';
import { generateKeyPairSigner } from '@solana/kit';
import { Env, SOL } from './harness';

const params = (e: Env, over: Record<string, unknown> = {}) => ({
  ...DEFAULT_CONFIG,
  feeCollector: e.collector.address,
  paused: 0,
  pendingAdmin: null,
  ...over,
});

describe('admin and safety', () => {
  it('pausing buys never stops sells', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, { ...NO_RULES, holderFeeSellBps: 100 });
    e.advance(60);
    const t = await e.wallet(20n * SOL);
    await e.buy(t, l, 2n * SOL);
    await e.ok([ix.updateConfig({ admin: e.admin, config: e.config }, params(e, { paused: PAUSE.BUYS | PAUSE.LAUNCHES | PAUSE.POOLS }))], e.admin);
    expect((await e.buy(t, l, SOL)).error).toMatch(/Paused/);
    await expect(e.launch_(creator, NO_RULES)).rejects.toThrow(/Paused/);
    expect((await e.sell(t, l, await e.tokens(l.mint, t.address))).ok).toBe(true);
  });

  it('keeps fees under their ceilings', async () => {
    const e = await Env.create();
    expect(await e.fails([ix.updateConfig({ admin: e.admin, config: e.config }, params(e, { curveProtocolFeeBps: 151 }))], e.admin)).toMatch(
      /ConfigOutOfBounds/,
    );
    expect(await e.fails([ix.updateConfig({ admin: e.admin, config: e.config }, params(e, { sniperStartBps: 5_001 }))], e.admin)).toMatch(
      /ConfigOutOfBounds/,
    );
    const stranger = await e.wallet();
    expect(await e.fails([ix.updateConfig({ admin: stranger, config: e.config }, params(e))], stranger)).toMatch(/Unauthorized/);
  });

  it('a fee change does not touch existing pools', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, NO_RULES);
    await e.ok([ix.updateConfig({ admin: e.admin, config: e.config }, params(e, { curveProtocolFeeBps: 150 }))], e.admin);
    expect(e.pool(l.pool).protocolFeeBps).toBe(DEFAULT_CONFIG.curveProtocolFeeBps);
  });

  it('hands the admin role over in two steps', async () => {
    const e = await Env.create();
    const next = await e.wallet();
    await e.ok([ix.updateConfig({ admin: e.admin, config: e.config }, params(e, { pendingAdmin: next.address }))], e.admin);
    expect(e.configState().admin).toBe(e.admin.address);
    await e.ok([ix.acceptAdmin({ newAdmin: next, config: e.config })], next);
    expect(e.configState().admin).toBe(next.address);
  });

  it('cannot be blocked by lamports sent to a pool or launch address in advance', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const mint = await generateKeyPairSigner();
    const pool = await poolAddress(mint.address);
    const launch = await launchAddress(mint.address);
    const poolHolding = await holdingAddress(mint.address, pool);
    for (const a of [pool, launch, poolHolding]) e.svm.airdrop(a, lamports(5_000n));
    await e.ok(
      [
        ix.createLaunch(
          { creator, config: e.config, mint, pool, poolHolding, launch, feeCollector: e.collector.address },
          { name: 'Griefed', symbol: 'GRF', uri: '', rules: NO_RULES },
        ),
      ],
      creator,
    );
    expect(e.pool(pool).mint).toBe(mint.address);
  });

  it('refuses a holding of another wallet as the trader holding', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, NO_RULES);
    const victim = await e.wallet(10n * SOL);
    await e.buy(victim, l, SOL);
    const thief = await e.wallet(10n * SOL);
    const r = await e.send(
      [ix.swap({ trader: thief, config: e.config, ...l, traderHolding: await holdingAddress(l.mint, victim.address) }, { side: 'sell', amountIn: 1n, minOut: 0n })],
      thief,
    );
    expect(r.error).toMatch(/OwnerMismatch/);
  });

  it('a launch with all rules stays within the compute budget', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, {
      creatorFeeBps: 100,
      holderFeeBuyBps: 100,
      holderFeeSellBps: 200,
      burnBuyBps: 50,
      burnSellBps: 100,
      maxWalletBps: 300,
      creatorLockSecs: 86_400,
      earlyWindowSecs: 30,
      earlyLockSecs: 3_600,
    });
    expect(Number(l.cu)).toBeLessThan(100_000);
    e.advance(60);
    const a = await e.wallet(20n * SOL);
    const b = await e.wallet(20n * SOL);
    await e.buy(a, l, SOL);
    const r = await e.buy(b, l, SOL);
    expect(Number(r.cu)).toBeLessThan(60_000);
    const s = await e.sell(b, l, await e.tokens(l.mint, b.address));
    expect(Number(s.cu)).toBeLessThan(60_000);
  });
});
