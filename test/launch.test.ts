import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MODE,
  NO_RULES,
  PRESETS,
  holdingAddress,
  ix,
  positionAddress,
  quoteBuy,
  quoteSell,
  type LaunchRules,
} from '../src';
import { Env, SOL } from './harness';

const plain: LaunchRules = { ...NO_RULES, creatorFeeBps: 100 };

describe('launch', () => {
  it('mints the whole supply into a curve pool, with no authorities left', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const collectorBefore = e.balance(e.collector.address);
    const l = await e.launch_(creator, plain);
    const m = e.mint(l.mint);
    expect(m.supply).toBe(DEFAULT_CONFIG.totalSupply);
    expect(m.mintAuthority).toBeNull();
    expect(m.freezeAuthority).toBeNull();
    expect(m.hookAuthority).toBeNull();
    expect(m.metadataAuthority).toBeNull();
    expect(m.hookProgram).toBeNull(); // no token rules: no hook at all
    const p = e.pool(l.pool);
    expect(p.mode).toBe(MODE.CURVE);
    expect(p.tokenReserve).toBe(DEFAULT_CONFIG.curveSaleTokens);
    expect(p.graduationTokens).toBe(DEFAULT_CONFIG.totalSupply - DEFAULT_CONFIG.curveSaleTokens);
    expect(e.holding(l.poolHolding).amount).toBe(DEFAULT_CONFIG.totalSupply);
    expect(e.balance(e.collector.address) - collectorBefore).toBe(DEFAULT_CONFIG.launchFee);
    expect(l.events.some((x) => x.kind === 'launchCreated')).toBe(true);
  });

  it('refuses rules outside the bounds', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    await expect(e.launch_(creator, { ...NO_RULES, creatorFeeBps: 201 })).rejects.toThrow(/RuleOutOfBounds/);
    await expect(e.launch_(creator, { ...NO_RULES, creatorFeeBps: 200, holderFeeBuyBps: 200, burnBuyBps: 200 })).rejects.toThrow(
      /RuleOutOfBounds/,
    );
    await expect(e.launch_(creator, { ...NO_RULES, maxWalletBps: 10 })).rejects.toThrow(/RuleOutOfBounds/);
  });

  it('accepts every preset', async () => {
    const e = await Env.create();
    const creator = await e.wallet(10n * SOL);
    for (const p of PRESETS) await e.launch_(creator, p.rules);
    expect(e.configState().totalLaunches).toBe(BigInt(PRESETS.length));
  });

  it('buys and sells exactly as quoted, and pays the creator', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const trader = await e.wallet(50n * SOL);
    const l = await e.launch_(creator, plain);
    e.advance(60); // past the sniper window

    const q = quoteBuy(e.pool(l.pool), e.launch(l.launch), 2n * SOL, e.now);
    const before = e.balance(trader.address);
    const r = await e.buy(trader, l, 2n * SOL);
    expect(r.ok).toBe(true);
    const got = await e.tokens(l.mint, trader.address);
    expect(got).toBe(q.tokensToTrader);
    const holdingRent = 2_171_520n;
    expect(before - e.balance(trader.address)).toBe(q.solIn + holdingRent + 5_000n);
    const swap = r.events.find((x) => x.kind === 'swap');
    expect(swap).toMatchObject({ side: 'buy', sol: q.solIn, tokens: q.tokensToTrader, creatorFee: q.fees.creator, sniperFee: 0n });
    expect(e.pool(l.pool).protocolFees).toBe(q.fees.protocol);
    expect(e.launch(l.launch).creatorFeesTotal).toBe(q.fees.creator);

    const qs = quoteSell(e.pool(l.pool), e.launch(l.launch), got / 2n);
    const b2 = e.balance(trader.address);
    const s = await e.sell(trader, l, got / 2n);
    expect(s.ok).toBe(true);
    expect(e.balance(trader.address) - b2).toBe(qs.solOut - 5_000n);

    // the creator claims its fees in SOL
    const c0 = e.balance(creator.address);
    const owed = e.launch(l.launch).creatorFeesTotal;
    await e.ok([ix.claimCreatorFees({ creator, launch: l.launch })], creator);
    expect(e.balance(creator.address) - c0).toBe(owed - 5_000n);
  });

  it('charges the sniper fee in the first seconds, except the creator once', async () => {
    const e = await Env.create();
    const creator = await e.wallet(20n * SOL);
    const sniper = await e.wallet(20n * SOL);
    const l = await e.launch_(creator, plain);

    const cq = quoteBuy(e.pool(l.pool), e.launch(l.launch), 1n * SOL, e.now, creator.address);
    expect(cq.fees.sniper).toBe(0n);
    await e.buy(creator, l, 1n * SOL);
    expect(e.launch(l.launch).creatorFirstBuy).toBe(true);

    e.advance(5);
    const q = quoteBuy(e.pool(l.pool), e.launch(l.launch), 1n * SOL, e.now, sniper.address);
    expect(q.fees.sniper).toBeGreaterThan(0n);
    const r = await e.buy(sniper, l, 1n * SOL);
    expect(r.events.find((x) => x.kind === 'swap')).toMatchObject({ sniperFee: q.fees.sniper });
    // sniper fees wait in the pool to deepen its liquidity at graduation
    expect(e.pool(l.pool).bonusSol).toBe(q.fees.sniper);
  });

  it('refuses a buy past the slippage limit', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, plain);
    e.advance(60);
    const q = quoteBuy(e.pool(l.pool), e.launch(l.launch), SOL, e.now);
    const r = await e.buy(creator, l, SOL, { minOut: q.tokensToTrader + 1n });
    expect(r.error).toMatch(/SlippageExceeded/);
  });

  it('graduates in the buy that sells the curve out, at the curve price, with liquidity locked', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const whale = await e.wallet(500n * SOL);
    const l = await e.launch_(creator, plain);
    e.advance(60);
    const before = e.pool(l.pool);
    const q = quoteBuy(before, e.launch(l.launch), 200n * SOL, e.now);
    expect(q.graduates).toBe(true);
    const r = await e.buy(whale, l, 200n * SOL);
    expect(r.ok).toBe(true);
    expect(r.events.some((x) => x.kind === 'graduated')).toBe(true);
    // only what the curve needed was charged
    expect(r.events.find((x) => x.kind === 'swap')).toMatchObject({ sol: q.solIn });

    const p = e.pool(l.pool);
    const lc = e.launch(l.launch);
    expect(p.mode).toBe(MODE.AMM);
    expect(lc.state).toBe(1);
    expect(p.lockedLp).toBe(p.lpSupply);
    expect(p.lpSupply).toBeGreaterThan(0n);
    // the AMM opens at the curve's last price (within rounding)
    const curvePrice = Number(before.virtualSol + q.net) / Number(before.virtualTokens - q.tokensOut);
    const ammPrice = Number(p.solReserve) / Number(p.tokenReserve);
    expect(Math.abs(ammPrice / curvePrice - 1)).toBeLessThan(0.001);
    expect(e.holding(l.poolHolding).amount).toBe(p.tokenReserve);
    expect(e.mint(l.mint).supply).toBe(DEFAULT_CONFIG.totalSupply - (DEFAULT_CONFIG.totalSupply - DEFAULT_CONFIG.curveSaleTokens - p.tokenReserve));

    // AMM trades match the quotes
    const trader = await e.wallet(20n * SOL);
    const qa = quoteBuy(p, lc, 3n * SOL, e.now);
    await e.buy(trader, l, 3n * SOL);
    expect(await e.tokens(l.mint, trader.address)).toBe(qa.tokensToTrader);
    const qs = quoteSell(e.pool(l.pool), e.launch(l.launch), qa.tokensToTrader);
    const b0 = e.balance(trader.address);
    await e.sell(trader, l, qa.tokensToTrader);
    expect(e.balance(trader.address) - b0).toBe(qs.solOut - 5_000n);

    // anyone can add and remove liquidity after graduation; the graduation LP stays locked
    const lp = await e.wallet(50n * SOL);
    await e.buy(lp, l, 10n * SOL);
    const position = await positionAddress(l.pool, lp.address);
    const ownerHolding = await holdingAddress(l.mint, lp.address);
    const pp = e.pool(l.pool);
    const sol = 2n * SOL;
    const maxTokens = (sol * pp.tokenReserve) / pp.solReserve + 1n;
    await e.ok(
      [ix.addLiquidity({ owner: lp, config: e.config, mint: l.mint, pool: l.pool, poolHolding: l.poolHolding, ownerHolding, position }, { solAmount: sol, maxTokens, minLp: 1n })],
      lp,
    );
    const pos = e.position(position);
    expect(pos.lp).toBeGreaterThan(0n);
    await e.ok(
      [ix.removeLiquidity({ owner: lp, mint: l.mint, pool: l.pool, poolHolding: l.poolHolding, ownerHolding, position }, { lp: pos.lp, minSol: 0n, minTokens: 0n })],
      lp,
    );
    expect(e.position(position).lp).toBe(0n);
    expect(e.pool(l.pool).lockedLp).toBe(p.lockedLp);
  });

  it('sends protocol fees to the fee collector, permissionlessly', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, plain);
    e.advance(60);
    await e.buy(creator, l, 3n * SOL);
    const fees = e.pool(l.pool).protocolFees;
    const anyone = await e.wallet();
    const b0 = e.balance(e.collector.address);
    await e.ok([ix.collectProtocolFees({ config: e.config, pool: l.pool, feeCollector: e.collector.address })], anyone);
    expect(e.balance(e.collector.address) - b0).toBe(fees);
    expect(e.pool(l.pool).protocolFees).toBe(0n);
  });
});
