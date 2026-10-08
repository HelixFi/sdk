/**
 * Quotes that mirror the program to the lamport (`programs/helix/src/dex.rs`), so a quote shown
 * on the site is what the swap does, before an external hook's cut.
 */
import { BPS, MODE, LAUNCH_STATE, RULES, SCALE } from './constants';
import type { Launch, Pool } from './layouts';

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export const bpsOf = (amount: bigint, bps: number) => (amount * BigInt(bps)) / BPS;

export function curveBuy(vs: bigint, vt: bigint, net: bigint): bigint {
  const after = ceilDiv(vs * vt, vs + net);
  return vt > after ? vt - after : 0n;
}

export function curveSell(vs: bigint, vt: bigint, tokens: bigint): bigint {
  const after = ceilDiv(vs * vt, vt + tokens);
  return vs > after ? vs - after : 0n;
}

export function ammOut(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, lpFeeBps: number): bigint {
  const inAfter = amountIn - bpsOf(amountIn, lpFeeBps);
  return (reserveOut * inAfter) / (reserveIn + inAfter);
}

/** The sniper fee at `now` (unix seconds): it falls linearly to zero over the window. */
export function sniperBps(l: Launch, now: bigint): number {
  const end = l.createdAt + BigInt(l.sniperWindowSecs);
  if (l.state !== LAUNCH_STATE.CURVE || now >= end || l.sniperWindowSecs === 0) return 0;
  const left = end - now;
  return Number(ceilDiv(BigInt(l.sniperStartBps) * left, BigInt(l.sniperWindowSecs)));
}

/** Whether trades pay the holder fee right now (only once enough tokens are held to share it). */
export function paysHolders(l: Launch): boolean {
  return (l.rules & RULES.HOLDER_REWARDS) !== 0 && l.eligible > 0n && l.eligible >= l.minEligible;
}

export interface FeeSplit {
  protocol: bigint;
  sniper: bigint;
  creator: bigint;
  holder: bigint;
}
const total = (f: FeeSplit) => f.protocol + f.sniper + f.creator + f.holder;
const split = (amount: bigint, p: number, s: number, c: number, h: number): FeeSplit => ({
  protocol: bpsOf(amount, p),
  sniper: bpsOf(amount, s),
  creator: bpsOf(amount, c),
  holder: bpsOf(amount, h),
});

export interface BuyQuote {
  /** Lamports the trader pays (at most the amount offered; less when the buy sells the curve out). */
  solIn: bigint;
  fees: FeeSplit;
  /** Lamports that reach the curve or the pool. */
  net: bigint;
  /** Tokens out of the pool, before the burn. */
  tokensOut: bigint;
  burned: bigint;
  /** Tokens the trader receives, before an external hook's cut. */
  tokensToTrader: bigint;
  /** Whether this buy sells the curve out and graduates the pool. */
  graduates: boolean;
  /** Price impact in basis points (execution vs. spot, fees excluded). */
  impactBps: number;
}

export function quoteBuy(pool: Pool, launch: Launch | null, solIn: bigint, now: bigint, trader?: string): BuyQuote {
  let s = 0,
    c = 0,
    h = 0,
    b = 0;
  if (launch) {
    c = launch.creatorFeeBps;
    b = launch.burnBuyBps;
    if (paysHolders(launch)) h = launch.holderFeeBuyBps;
    const firstCreatorBuy = trader !== undefined && trader === launch.creator && !launch.creatorFirstBuy;
    if (!firstCreatorBuy) s = sniperBps(launch, now);
  }
  const p = pool.protocolFeeBps;
  const totalBps = BigInt(p + s + c + h);
  let gross = solIn;
  let fees = split(gross, p, s, c, h);
  let net = gross - total(fees);
  let tokens =
    pool.mode === MODE.CURVE
      ? curveBuy(pool.virtualSol, pool.virtualTokens, net)
      : ammOut(pool.solReserve, pool.tokenReserve, net, pool.lpFeeBps);
  let graduates = false;
  if (pool.mode === MODE.CURVE && tokens >= pool.tokenReserve) {
    tokens = pool.tokenReserve;
    const k = pool.virtualSol * pool.virtualTokens;
    const needed = ceilDiv(k, pool.virtualTokens - tokens) - pool.virtualSol;
    gross = ceilDiv(needed * BPS, BPS - totalBps);
    if (gross > solIn) gross = solIn;
    fees = split(gross, p, s, c, h);
    net = gross - total(fees);
    graduates = true;
  }
  const burned = bpsOf(tokens, b);
  const spot = spotPrice(pool);
  const exec = tokens > 0n ? Number(net) / Number(tokens) : 0;
  return {
    solIn: gross,
    fees,
    net,
    tokensOut: tokens,
    burned,
    tokensToTrader: tokens - burned,
    graduates,
    impactBps: spot > 0 && exec > 0 ? Math.max(0, Math.round((exec / spot - 1) * 10_000)) : 0,
  };
}

export interface SellQuote {
  tokensIn: bigint;
  burned: bigint;
  /** Lamports out of the pool, before fees. */
  gross: bigint;
  fees: FeeSplit;
  /** Lamports the trader receives. */
  solOut: bigint;
  impactBps: number;
}

/** `tokensIn` is what reaches the pool (after an external hook's cut, if any). */
export function quoteSell(pool: Pool, launch: Launch | null, tokensIn: bigint, eligibleAfter?: bigint): SellQuote {
  let b = 0,
    c = 0,
    h = 0;
  if (launch) {
    b = launch.burnSellBps;
    c = launch.creatorFeeBps;
    const l = eligibleAfter === undefined ? launch : { ...launch, eligible: eligibleAfter };
    if (paysHolders(l)) h = launch.holderFeeSellBps;
  }
  const burned = bpsOf(tokensIn, b);
  const net = tokensIn - burned;
  let gross =
    pool.mode === MODE.CURVE
      ? curveSell(pool.virtualSol, pool.virtualTokens, net)
      : ammOut(pool.tokenReserve, pool.solReserve, net, pool.lpFeeBps);
  if (pool.mode === MODE.CURVE && gross > pool.solReserve) gross = pool.solReserve;
  const fees = split(gross, pool.protocolFeeBps, 0, c, h);
  const spot = spotPrice(pool);
  const exec = net > 0n ? Number(gross) / Number(net) : 0;
  return {
    tokensIn,
    burned,
    gross,
    fees,
    solOut: gross - total(fees),
    impactBps: spot > 0 && exec > 0 ? Math.max(0, Math.round((1 - exec / spot) * 10_000)) : 0,
  };
}

/** Lamports per base unit of the token, at the pool's current state. */
export function spotPrice(pool: Pool): number {
  if (pool.mode === MODE.CURVE) return pool.virtualTokens > 0n ? Number(pool.virtualSol) / Number(pool.virtualTokens) : 0;
  return pool.tokenReserve > 0n ? Number(pool.solReserve) / Number(pool.tokenReserve) : 0;
}

/** Market cap in lamports: spot price × supply. */
export function marketCapLamports(pool: Pool, supply: bigint): number {
  return spotPrice(pool) * Number(supply);
}

/** How much of the curve has sold, 0..1 (1 once graduated). */
export function curveProgress(pool: Pool, saleTokens: bigint): number {
  if (pool.mode !== MODE.CURVE) return 1;
  if (saleTokens === 0n) return 0;
  return Number(saleTokens - pool.tokenReserve) / Number(saleTokens);
}

/**
 * The fee of one side as a single compounded figure, the way the site shows it:
 * protocol + creator + holders (from SOL) and burn (from tokens).
 */
export function sideFeeBps(pool: Pool, launch: Launch | null, side: 'buy' | 'sell'): number {
  if (!launch) return pool.protocolFeeBps + (pool.mode === MODE.AMM ? pool.lpFeeBps : 0);
  const h = side === 'buy' ? launch.holderFeeBuyBps : launch.holderFeeSellBps;
  const b = side === 'buy' ? launch.burnBuyBps : launch.burnSellBps;
  const lp = pool.mode === MODE.AMM ? pool.lpFeeBps : 0;
  const sol = (pool.protocolFeeBps + launch.creatorFeeBps + h) / 10_000;
  const rest = (1 - sol) * (1 - lp / 10_000) * (1 - b / 10_000);
  return Math.round((1 - rest) * 10_000);
}

/** Rewards a holding can claim right now, mirroring the kit's sync + settle off chain. */
export function claimableRewards(l: Launch, holding: { owner: string; amount: bigint; hookData: Uint8Array }, now: bigint): bigint {
  if ((l.rules & RULES.HOLDER_REWARDS) === 0 || holding.owner === l.pool || holding.owner === l.bridge) return 0n;
  let acc = l.accPerShare;
  let held = l.held;
  if (l.streamEnd > l.streamStart && l.streamReleased < l.streamTotal) {
    const span = l.streamEnd - l.streamStart;
    const elapsedRaw = (now < l.streamEnd ? now : l.streamEnd) - l.streamStart;
    const elapsed = elapsedRaw > 0n ? elapsedRaw : 0n;
    const target = (l.streamTotal * elapsed) / span;
    if (target > l.streamReleased) held += target - l.streamReleased;
  }
  if (held > 0n && l.eligible > 0n && l.eligible >= l.minEligible) {
    acc += (held * SCALE + l.rem) / l.eligible;
  }
  const v = new DataView(holding.hookData.buffer, holding.hookData.byteOffset, 64);
  const snap = v.getBigUint64(0, true) + (v.getBigUint64(8, true) << 64n);
  const owed = v.getBigUint64(16, true);
  const earned = (holding.amount * (acc - snap)) / SCALE;
  const claimable = owed + earned;
  const available = l.rewardsIn - l.rewardsClaimed;
  return claimable < available ? claimable : available;
}
