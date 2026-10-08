import { describe, expect, it } from 'vitest';
import {
  HELIX_PROGRAM_ID,
  NO_RULES,
  claimableRewards,
  decodeKitHookData,
  holdingAddress,
  hookAccounts,
  ix,
  quoteBuy,
  type LaunchRules,
} from '../src';
import { Env, SOL } from './harness';

const DAY = 86_400;

describe('kit rules', () => {
  it('installs the kit as the hook only when a token rule is on', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, { ...NO_RULES, holderFeeBuyBps: 100, holderFeeSellBps: 100 });
    expect(e.mint(l.mint).hookProgram).toBe(HELIX_PROGRAM_ID);
  });

  it('pays holders in SOL, pro rata, once enough is held, and lets them claim', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const rules: LaunchRules = { ...NO_RULES, holderFeeBuyBps: 200, holderFeeSellBps: 200 };
    const l = await e.launch_(creator, rules);
    e.advance(60);
    const alice = await e.wallet(50n * SOL);
    const bob = await e.wallet(50n * SOL);
    const carol = await e.wallet(50n * SOL);

    // the first buy: nobody holds yet, so no holder fee
    const q0 = quoteBuy(e.pool(l.pool), e.launch(l.launch), 5n * SOL, e.now);
    expect(q0.fees.holder).toBe(0n);
    await e.buy(alice, l, 5n * SOL);
    await e.buy(bob, l, 5n * SOL);
    const la = e.launch(l.launch);
    expect(la.eligible).toBe((await e.tokens(l.mint, alice.address)) + (await e.tokens(l.mint, bob.address)));

    // carol's buy pays holders: alice and bob, pro rata to what they held
    const q = quoteBuy(e.pool(l.pool), e.launch(l.launch), 4n * SOL, e.now);
    expect(q.fees.holder).toBeGreaterThan(0n);
    await e.buy(carol, l, 4n * SOL);
    const lb = e.launch(l.launch);
    const ha = e.holding(await holdingAddress(l.mint, alice.address));
    const hb = e.holding(await holdingAddress(l.mint, bob.address));
    const hc = e.holding(await holdingAddress(l.mint, carol.address));
    const ca = claimableRewards(lb, ha, e.now);
    const cb = claimableRewards(lb, hb, e.now);
    const cc = claimableRewards(lb, hc, e.now);
    // bob had the second fee (from his own buy) shared with alice only, carol none of hers
    expect(cc).toBe(0n);
    expect(ca + cb).toBeLessThanOrEqual(lb.rewardsIn);
    expect(lb.rewardsIn - (ca + cb)).toBeLessThan(10n); // rounding dust only
    expect(Number(ca) / Number(cb)).toBeGreaterThan(Number(ha.amount) / Number(hb.amount));

    const before = e.balance(alice.address);
    const r = await e.ok([ix.claimRewards({ owner: alice, mint: l.mint, launch: l.launch, holding: await holdingAddress(l.mint, alice.address) })], alice);
    expect(r.events.find((x) => x.kind === 'rewardsClaimed')).toMatchObject({ lamports: ca });
    expect(e.balance(alice.address) - before).toBe(ca - 5_000n);
    expect(claimableRewards(e.launch(l.launch), e.holding(await holdingAddress(l.mint, alice.address)), e.now)).toBe(0n);
  });

  it('keeps rewards earned by a wallet that sold everything', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, { ...NO_RULES, holderFeeBuyBps: 200, holderFeeSellBps: 200 });
    e.advance(60);
    const alice = await e.wallet(50n * SOL);
    const bob = await e.wallet(50n * SOL);
    await e.buy(alice, l, 5n * SOL);
    await e.buy(bob, l, 5n * SOL);
    const owedBefore = claimableRewards(e.launch(l.launch), e.holding(await holdingAddress(l.mint, alice.address)), e.now);
    expect(owedBefore).toBeGreaterThan(0n);
    await e.sell(alice, l, await e.tokens(l.mint, alice.address));
    const h = e.holding(await holdingAddress(l.mint, alice.address));
    expect(h.amount).toBe(0n);
    expect(decodeKitHookData(h.hookData).owed).toBeGreaterThanOrEqual(owedBefore);
    await e.ok([ix.claimRewards({ owner: alice, mint: l.mint, launch: l.launch, holding: await holdingAddress(l.mint, alice.address) })], alice);
  });

  it('streams a share to holders over an hour', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, { ...NO_RULES, holderFeeSellBps: 100 });
    e.advance(60);
    const alice = await e.wallet(50n * SOL);
    await e.buy(alice, l, 5n * SOL);
    const fan = await e.wallet(10n * SOL);
    await e.ok([ix.shareWithHolders({ payer: fan, launch: l.launch }, 1n * SOL)], fan);
    const ha = await holdingAddress(l.mint, alice.address);
    e.advance(1_800);
    const half = claimableRewards(e.launch(l.launch), e.holding(ha), e.now);
    expect(Number(half)).toBeGreaterThan(0.49e9);
    expect(Number(half)).toBeLessThan(0.51e9);
    e.advance(3_600);
    const all = claimableRewards(e.launch(l.launch), e.holding(ha), e.now);
    expect(all).toBeGreaterThanOrEqual(SOL - 10n);
    await e.ok([ix.claimRewards({ owner: alice, mint: l.mint, launch: l.launch, holding: ha })], alice);
    expect(await e.fails([ix.shareWithHolders({ payer: fan, launch: l.launch }, 1000n)], fan)).toMatch(/ShareTooSmall/);
  });

  it('caps every wallet until graduation, but never blocks a sell', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, { ...NO_RULES, maxWalletBps: 100 }); // 1% = 10M tokens
    e.advance(60);
    const whale = await e.wallet(100n * SOL);
    const r = await e.buy(whale, l, 5n * SOL); // ≈ 45M tokens > 10M
    expect(r.error).toMatch(/MaxWalletExceeded/);
    const ok = await e.buy(whale, l, SOL / 4n);
    expect(ok.ok).toBe(true);
    const s = await e.sell(whale, l, await e.tokens(l.mint, whale.address));
    expect(s.ok).toBe(true);
  });

  it("locks the creator's wallet until its unlock time", async () => {
    const e = await Env.create();
    const creator = await e.wallet(20n * SOL);
    const l = await e.launch_(creator, { ...NO_RULES, creatorLockSecs: 7 * DAY });
    await e.buy(creator, l, SOL);
    const got = await e.tokens(l.mint, creator.address);
    expect((await e.sell(creator, l, got)).error).toMatch(/CreatorLocked/);
    const friend = await e.wallet();
    const src = await holdingAddress(l.mint, creator.address);
    const dst = await holdingAddress(l.mint, friend.address);
    await e.ok([ix.createHolding({ payer: friend, holding: dst, mint: l.mint, owner: friend.address })], friend);
    const hook = await hookAccounts(l.mint, e.mint(l.mint));
    expect(await e.fails([ix.transfer({ authority: creator, source: src, destination: dst, mint: l.mint, hook }, 1n)], creator)).toMatch(
      /CreatorLocked/,
    );
    e.advance(7 * DAY + 1);
    expect((await e.sell(creator, l, got)).ok).toBe(true);
  });

  it('locks tokens bought in the early window until the unlock', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, { ...NO_RULES, earlyWindowSecs: 60, earlyLockSecs: DAY });
    const early = await e.wallet(20n * SOL);
    await e.buy(early, l, SOL);
    const got = await e.tokens(l.mint, early.address);
    expect(decodeKitHookData(e.holding(await holdingAddress(l.mint, early.address)).hookData).earlyLocked).toBe(got);
    expect((await e.sell(early, l, got)).error).toMatch(/EarlyBuyerLocked/);
    e.advance(120);
    // tokens bought after the window are free to move
    await e.buy(early, l, SOL);
    const more = (await e.tokens(l.mint, early.address)) - got;
    expect((await e.sell(early, l, more)).ok).toBe(true);
    e.advance(DAY);
    expect((await e.sell(early, l, got)).ok).toBe(true);
  });

  it('burns part of every trade', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, { ...NO_RULES, burnBuyBps: 100, burnSellBps: 100 });
    e.advance(60);
    const t = await e.wallet(20n * SOL);
    const supply0 = e.mint(l.mint).supply;
    const q = quoteBuy(e.pool(l.pool), e.launch(l.launch), SOL, e.now);
    const r = await e.buy(t, l, SOL);
    expect(r.events.find((x) => x.kind === 'swap')).toMatchObject({ burned: q.burned });
    expect(e.mint(l.mint).supply).toBe(supply0 - q.burned);
  });
});
