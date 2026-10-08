import { describe, expect, it } from 'vitest';
import { generateKeyPairSigner, lamports } from '@solana/kit';
import { AUTHORITY, holdingAddress, ix } from '../src';
import { Env, SOL } from './harness';

async function setup() {
  const e = await Env.create();
  const owner = await e.wallet();
  const mint = await generateKeyPairSigner();
  await e.ok(
    [
      ix.createMint(
        { payer: owner, mint },
        {
          decimals: 6,
          maxSupply: 1_000_000n,
          mintAuthority: owner.address,
          freezeAuthority: owner.address,
          metadataAuthority: owner.address,
          name: 'Plain',
          symbol: 'PLN',
          uri: 'ipfs://x',
        },
      ),
    ],
    owner,
  );
  const alice = await e.wallet();
  const bob = await e.wallet();
  const ha = await holdingAddress(mint.address, alice.address);
  const hb = await holdingAddress(mint.address, bob.address);
  await e.ok(
    [
      ix.createHolding({ payer: owner, holding: ha, mint: mint.address, owner: alice.address }),
      ix.createHolding({ payer: owner, holding: hb, mint: mint.address, owner: bob.address }),
    ],
    owner,
  );
  return { e, owner, mint: mint.address, alice, bob, ha, hb };
}

describe('token standard', () => {
  it('creates a mint with its metadata on chain', async () => {
    const { e, mint, owner } = await setup();
    const m = e.mint(mint);
    expect(m.name).toBe('Plain');
    expect(m.symbol).toBe('PLN');
    expect(m.uri).toBe('ipfs://x');
    expect(m.mintAuthority).toBe(owner.address);
    expect(m.hookProgram).toBeNull();
  });

  it('mints, transfers and burns, and keeps the supply', async () => {
    const { e, owner, mint, alice, ha, hb } = await setup();
    await e.ok([ix.mintTo({ mintAuthority: owner, mint, destination: ha }, 600_000n)], owner);
    const r = await e.ok([ix.transfer({ authority: alice, source: ha, destination: hb, mint }, 250_000n)], alice);
    expect(r.events.find((x) => x.kind === 'transfer')).toMatchObject({ amount: 250_000n, cut: 0n });
    await e.ok([ix.burn({ authority: alice, holding: ha, mint }, 50_000n)], alice);
    expect(e.holding(ha).amount).toBe(300_000n);
    expect(e.holding(hb).amount).toBe(250_000n);
    expect(e.mint(mint).supply).toBe(550_000n);
  });

  it('refuses minting past the max supply and minting by anyone else', async () => {
    const { e, owner, mint, alice, ha } = await setup();
    expect(await e.fails([ix.mintTo({ mintAuthority: owner, mint, destination: ha }, 1_000_001n)], owner)).toMatch(/MaxSupplyExceeded/);
    expect(await e.fails([ix.mintTo({ mintAuthority: alice, mint, destination: ha }, 1n)], alice)).toMatch(/Unauthorized/);
  });

  it('lets a delegate spend only its allowance', async () => {
    const { e, owner, mint, alice, bob, ha, hb } = await setup();
    await e.ok([ix.mintTo({ mintAuthority: owner, mint, destination: ha }, 1000n)], owner);
    await e.ok([ix.approve({ owner: alice, holding: ha, delegate: bob.address }, 300n)], alice);
    await e.ok([ix.transfer({ authority: bob, source: ha, destination: hb, mint }, 200n)], bob);
    expect(await e.fails([ix.transfer({ authority: bob, source: ha, destination: hb, mint }, 200n)], bob)).toMatch(/InsufficientFunds/);
    expect(e.holding(ha).delegatedAmount).toBe(100n);
  });

  it('freezes a holding, and refuses a transfer to itself', async () => {
    const { e, owner, mint, alice, ha, hb } = await setup();
    await e.ok([ix.mintTo({ mintAuthority: owner, mint, destination: ha }, 1000n)], owner);
    expect(await e.fails([ix.transfer({ authority: alice, source: ha, destination: ha, mint }, 1n)], alice)).toMatch(/SameHolding/);
    await e.ok([ix.setFrozen({ freezeAuthority: owner, mint, holding: ha }, true)], owner);
    expect(await e.fails([ix.transfer({ authority: alice, source: ha, destination: hb, mint }, 1n)], alice)).toMatch(/HoldingFrozen/);
  });

  it('revokes an authority for good', async () => {
    const { e, owner, mint, ha } = await setup();
    await e.ok([ix.setAuthority({ current: owner, mint }, AUTHORITY.MINT, null)], owner);
    expect(e.mint(mint).mintAuthority).toBeNull();
    expect(await e.fails([ix.mintTo({ mintAuthority: owner, mint, destination: ha }, 1n)], owner)).toMatch(/NoAuthority/);
  });

  it('closes an empty holding and returns its rent', async () => {
    const { e, mint, alice, ha } = await setup();
    const before = e.balance(alice.address);
    await e.ok([ix.closeHolding({ owner: alice, holding: ha, destination: alice.address, mint })], alice);
    expect(e.data(ha)).toBeNull();
    expect(e.balance(alice.address)).toBeGreaterThan(before);
  });

  it('creates a holding even if someone sent lamports to its address first', async () => {
    const { e, owner, mint } = await setup();
    const carol = await e.wallet();
    const hc = await holdingAddress(mint, carol.address);
    e.svm.airdrop(hc, lamports(1_000n));
    await e.ok([ix.createHolding({ payer: owner, holding: hc, mint, owner: carol.address })], owner);
    expect(e.holding(hc).owner).toBe(carol.address);
    // and creating it again is a no-op
    await e.ok([ix.createHolding({ payer: owner, holding: hc, mint, owner: carol.address })], owner);
    void SOL;
  });
});
