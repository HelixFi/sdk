import { describe, expect, it } from 'vitest';
import {
  CONTEXT,
  EXAMPLE_HOOK_PROGRAM_ID,
  HOOK_FLAGS,
  NO_RULES,
  exampleHookConfigAddress,
  exampleHookExtras,
  holdingAddress,
  hookAccounts,
  ix,
  launchAddress,
  poolAddress,
  swapHookAccounts,
} from '../src';
import { generateKeyPairSigner } from '@solana/kit';
import { Env, SOL } from './harness';

const FLAGS = HOOK_FLAGS.BEFORE_TRANSFER | HOOK_FLAGS.TRANSFER_RETURNS_DELTA | HOOK_FLAGS.WRITES_HOOK_DATA;

/** A launch whose token runs the example `trade_tax` hook: 3% of every trade to a collector. */
async function taxedLaunch(e: Env) {
  const creator = await e.wallet(20n * SOL);
  const collector = await e.wallet();
  // The launch creates the mint, so prepare the hook for the address the mint will have.
  const mint = await generateKeyPairSigner();
  const collectorHolding = await holdingAddress(mint.address, collector.address);
  const hookConfig = await exampleHookConfigAddress(EXAMPLE_HOOK_PROGRAM_ID, mint.address);
  await e.ok(
    [ix.exampleHookInit({ payer: creator, config: hookConfig, mint: mint.address, hookProgram: EXAMPLE_HOOK_PROGRAM_ID }, { feeBps: 300, collectorOwner: collector.address, collectorHolding })],
    creator,
  );
  const extras = await exampleHookExtras(EXAMPLE_HOOK_PROGRAM_ID, mint.address, collectorHolding);
  const hook = await hookAccounts(mint.address, { hookProgram: EXAMPLE_HOOK_PROGRAM_ID }, extras);
  const pool = await poolAddress(mint.address);
  const launch = await launchAddress(mint.address);
  const poolHolding = await holdingAddress(mint.address, pool);
  await e.ok(
    [
      ix.createLaunch(
        { creator, config: e.config, mint, pool, poolHolding, launch, feeCollector: e.collector.address, hook },
        { name: 'Taxed', symbol: 'TAX', uri: '', rules: { ...NO_RULES, creatorFeeBps: 50 }, customHook: EXAMPLE_HOOK_PROGRAM_ID, customHookFlags: FLAGS },
      ),
    ],
    creator,
  );
  // the collector's holding must exist to receive cuts
  await e.ok([ix.createHolding({ payer: collector, holding: collectorHolding, mint: mint.address, owner: collector.address })], collector);
  const swapHook = await swapHookAccounts({ hookProgram: EXAMPLE_HOOK_PROGRAM_ID }, extras);
  return { creator, collector, collectorHolding, hook, swapHook, l: { mint: mint.address, pool, launch, poolHolding } };
}

describe('external hooks', () => {
  it('takes a cut on trades, not on transfers between wallets', async () => {
    const e = await Env.create();
    const { collectorHolding, hook, swapHook, l } = await taxedLaunch(e);
    e.advance(60);
    const t = await e.wallet(20n * SOL);
    const r = await e.buy(t, l, 2n * SOL, { hook: swapHook });
    expect(r.ok, r.error ?? '').toBe(true);
    const transfer = r.events.find((x) => x.kind === 'transfer');
    expect(transfer).toBeDefined();
    if (transfer?.kind !== 'transfer') throw new Error();
    expect(transfer.context).toBe(CONTEXT.BUY);
    expect(transfer.cut).toBe((transfer.amount * 300n) / 10_000n);
    expect(e.holding(collectorHolding).amount).toBe(transfer.cut);
    expect(await e.tokens(l.mint, t.address)).toBe(transfer.amount - transfer.cut);

    // a gift between wallets pays nothing
    const friend = await e.wallet();
    const src = await holdingAddress(l.mint, t.address);
    const dst = await holdingAddress(l.mint, friend.address);
    await e.ok([ix.createHolding({ payer: friend, holding: dst, mint: l.mint, owner: friend.address })], friend);
    const g = await e.ok([ix.transfer({ authority: t, source: src, destination: dst, mint: l.mint, hook }, 1_000_000n)], t);
    expect(g.events.find((x) => x.kind === 'transfer')).toMatchObject({ cut: 0n, context: CONTEXT.PLAIN });
    expect(e.holding(dst).amount).toBe(1_000_000n);

    // the hook kept the arrival time in the 64 bytes
    const data = e.holding(dst).hookData;
    const ts = new DataView(data.buffer, data.byteOffset).getBigInt64(0, true);
    expect(ts).toBe(e.now);
  });

  it('a sell pays the cut from what reaches the pool', async () => {
    const e = await Env.create();
    const { swapHook, l, collectorHolding } = await taxedLaunch(e);
    e.advance(60);
    const t = await e.wallet(20n * SOL);
    await e.buy(t, l, 2n * SOL, { hook: swapHook });
    const before = e.holding(collectorHolding).amount;
    const all = await e.tokens(l.mint, t.address);
    const s = await e.sell(t, l, all, { hook: swapHook });
    expect(s.ok, s.error ?? '').toBe(true);
    expect(e.holding(collectorHolding).amount - before).toBe((all * 300n) / 10_000n);
    // the hook forgot the emptied holding's state, so it can close and return its rent
    const h = await holdingAddress(l.mint, t.address);
    expect(e.holding(h).hookData.every((b) => b === 0)).toBe(true);
    await e.ok([ix.closeHolding({ owner: t, holding: h, destination: t.address, mint: l.mint })], t);
  });

  it('refuses a swap without the hook accounts', async () => {
    const e = await Env.create();
    const { l } = await taxedLaunch(e);
    const t = await e.wallet(20n * SOL);
    const r = await e.buy(t, l, SOL);
    expect(r.error).toMatch(/HookAccountsMissing/);
  });
});
