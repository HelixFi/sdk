import { describe, expect, it } from 'vitest';
import { generateKeyPairSigner, getAddressEncoder, lamports, type Address, type Instruction, type KeyPairSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  HELIX_PROGRAM_ID,
  MINT_FLAGS,
  NO_RULES,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  METAPLEX_PROGRAM_ID,
  ataAddress,
  claimableRewards,
  decodeTokenAccount,
  decodeWrapper,
  holdingAddress,
  hookAccounts,
  ix,
  metaplexMetadataAddress,
  mirrorAddress,
  mirrorMintAddress,
  quoteBuy,
  wrappedMintAddress,
  wrapperAddress,
  decodeMirror,
} from '../src';
import { Env, SOL } from './harness';

const enc = getAddressEncoder();

/** A classic SPL mint with `supply` minted to `owner`'s ATA. */
async function splMint(e: Env, owner: KeyPairSigner, decimals: number, supply: bigint) {
  const mint = await generateKeyPairSigner();
  const init = new Uint8Array(35);
  init[0] = 20;
  init[1] = decimals;
  init.set(enc.encode(owner.address), 2);
  const ata = await ataAddress(owner.address, mint.address, TOKEN_PROGRAM_ID);
  const mintTo = new Uint8Array(9);
  mintTo[0] = 7;
  new DataView(mintTo.buffer).setBigUint64(1, supply, true);
  const ixs: Instruction[] = [
    getCreateAccountInstruction({ payer: owner, newAccount: mint, lamports: 2_000_000n, space: 82n, programAddress: TOKEN_PROGRAM_ID }),
    { programAddress: TOKEN_PROGRAM_ID, accounts: [{ address: mint.address, role: 1 }], data: init },
    ix.createAtaIdempotent({ payer: owner, ata, owner: owner.address, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ID }),
    {
      programAddress: TOKEN_PROGRAM_ID,
      accounts: [
        { address: mint.address, role: 1 },
        { address: ata, role: 1 },
        { address: owner.address, role: 2, signer: owner } as never,
      ],
      data: mintTo,
    },
  ];
  await e.ok(ixs, owner);
  return { mint: mint.address, ata };
}

/** A Metaplex metadata account, as the Metaplex program would hold it (name, symbol, uri; NUL-padded). */
async function metaplexFor(e: Env, mint: Address, name: string, symbol: string) {
  const s = (v: string, n: number) => {
    const b = new Uint8Array(4 + n);
    new DataView(b.buffer).setUint32(0, n, true);
    b.set(new TextEncoder().encode(v), 4);
    return b;
  };
  const parts = [new Uint8Array([4]), new Uint8Array(32), enc.encode(mint), s(name, 32), s(symbol, 10), s('https://x.example/m.json', 200)];
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    data.set(p, o);
    o += p.length;
  }
  e.svm.setAccount({ address: await metaplexMetadataAddress(mint), data, executable: false, lamports: lamports(5_000_000n), programAddress: METAPLEX_PROGRAM_ID, space: BigInt(data.length) });
}

async function wrapAccounts(owner: KeyPairSigner, splMintA: Address, tokenProgram: Address) {
  const wrapper = await wrapperAddress(splMintA);
  const helixMint = await wrappedMintAddress(splMintA);
  return {
    owner,
    splMint: splMintA,
    tokenProgram,
    wrapper,
    helixMint,
    vault: await ataAddress(wrapper, splMintA, tokenProgram),
    ownerToken: await ataAddress(owner.address, splMintA, tokenProgram),
    ownerHolding: await holdingAddress(helixMint, owner.address),
  };
}

function tokenBalance(e: Env, a: Address) {
  const d = e.data(a);
  return d ? decodeTokenAccount(d).amount : 0n;
}

/** Reads name and symbol from a Token-2022 mint's metadata extension. */
function t22Metadata(d: Uint8Array) {
  let off = 166;
  const v = new DataView(d.buffer, d.byteOffset);
  while (off + 4 <= d.length) {
    const t = v.getUint16(off, true);
    const len = v.getUint16(off + 2, true);
    if (t === 19) {
      let p = off + 4 + 64;
      const str = () => {
        const n = v.getUint32(p, true);
        const out = new TextDecoder().decode(d.subarray(p + 4, p + 4 + n));
        p += 4 + n;
        return out;
      };
      return { name: str(), symbol: str() };
    }
    if (t === 0) break;
    off += 4 + len;
  }
  return null;
}

describe('bridge in: SPL → HELIX', () => {
  it('wraps one for one with the token’s own name, and unwraps back', async () => {
    const e = await Env.create();
    const user = await e.wallet(10n * SOL);
    const { mint, ata } = await splMint(e, user, 6, 1_000_000_000n);
    await metaplexFor(e, mint, 'Bonk Test', 'BONKT');
    const a = await wrapAccounts(user, mint, TOKEN_PROGRAM_ID);
    await e.ok(
      [
        ix.registerWrapper({
          payer: user,
          splMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          wrapper: a.wrapper,
          helixMint: a.helixMint,
          vault: a.vault,
          metaplexMetadata: await metaplexMetadataAddress(mint),
        }),
      ],
      user,
    );
    const m = e.mint(a.helixMint);
    expect(m.name).toBe('Bonk Test');
    expect(m.symbol).toBe('BONKT');
    expect(m.decimals).toBe(6);
    expect(m.flags & MINT_FLAGS.BRIDGED).toBe(MINT_FLAGS.BRIDGED);
    expect(m.hookProgram).toBeNull();

    await e.ok(
      [ix.createHolding({ payer: user, holding: a.ownerHolding, mint: a.helixMint, owner: user.address }), ix.wrap(a, 400_000_000n)],
      user,
    );
    expect(e.holding(a.ownerHolding).amount).toBe(400_000_000n);
    expect(tokenBalance(e, a.vault)).toBe(400_000_000n);
    expect(tokenBalance(e, ata)).toBe(600_000_000n);
    expect(e.mint(a.helixMint).supply).toBe(400_000_000n);

    await e.ok([ix.unwrap(a, 150_000_000n)], user);
    expect(e.holding(a.ownerHolding).amount).toBe(250_000_000n);
    expect(tokenBalance(e, a.vault)).toBe(250_000_000n);
    expect(tokenBalance(e, ata)).toBe(750_000_000n);
    expect(e.mint(a.helixMint).supply).toBe(250_000_000n);
    const w = decodeWrapper(e.data(a.wrapper)!);
    expect(w.totalIn).toBe(400_000_000n);
    expect(w.totalOut).toBe(150_000_000n);
  });

  it('falls back to a plain name without metadata, and refuses a second registration', async () => {
    const e = await Env.create();
    const user = await e.wallet(10n * SOL);
    const { mint } = await splMint(e, user, 9, 5n);
    const a = await wrapAccounts(user, mint, TOKEN_PROGRAM_ID);
    const reg = ix.registerWrapper({ payer: user, splMint: mint, tokenProgram: TOKEN_PROGRAM_ID, wrapper: a.wrapper, helixMint: a.helixMint, vault: a.vault, metaplexMetadata: HELIX_PROGRAM_ID });
    await e.ok([reg], user);
    expect(e.mint(a.helixMint).name).toBe('Bridged token');
    expect(await e.fails([reg], user)).toMatch(/AlreadyInitialized|already/i);
  });

  it('refuses a Token-2022 mint with a permanent delegate', async () => {
    const e = await Env.create();
    const user = await e.wallet(10n * SOL);
    const mint = (await generateKeyPairSigner()).address;
    const d = new Uint8Array(166 + 4 + 32);
    d.set([1, 0, 0, 0], 0);
    d.set(enc.encode(user.address), 4);
    d[44] = 6;
    d[45] = 1;
    d[165] = 1; // account type: mint
    new DataView(d.buffer).setUint16(166, 12, true); // PermanentDelegate
    new DataView(d.buffer).setUint16(168, 32, true);
    d.set(enc.encode(user.address), 170);
    e.svm.setAccount({ address: mint, data: d, executable: false, lamports: lamports(5_000_000n), programAddress: TOKEN_2022_PROGRAM_ID, space: BigInt(d.length) });
    const a = await wrapAccounts(user, mint, TOKEN_2022_PROGRAM_ID);
    const err = await e.fails(
      [ix.registerWrapper({ payer: user, splMint: mint, tokenProgram: TOKEN_2022_PROGRAM_ID, wrapper: a.wrapper, helixMint: a.helixMint, vault: a.vault, metaplexMetadata: HELIX_PROGRAM_ID })],
      user,
    );
    expect(err).toMatch(/UnsupportedMint/);
  });
});

async function graduatedLaunch(e: Env, rules = NO_RULES) {
  const creator = await e.wallet(10n * SOL);
  const l = await e.launch_(creator, rules);
  e.advance(60);
  const whale = await e.wallet(500n * SOL);
  const q = quoteBuy(e.pool(l.pool), e.launch(l.launch), 200n * SOL, e.now);
  const r = await e.buy(whale, l, q.solIn + SOL);
  expect(r.ok).toBe(true);
  expect(e.launch(l.launch).state).toBe(1);
  return { ...l, whale };
}

async function mirrorAccounts(owner: KeyPairSigner, helixMint: Address) {
  const mirror = await mirrorAddress(helixMint);
  const mirrorMint = await mirrorMintAddress(helixMint);
  return {
    owner,
    helixMint,
    mirror,
    mirrorMint,
    vault: await holdingAddress(helixMint, mirror),
    ownerHolding: await holdingAddress(helixMint, owner.address),
    ownerToken: await ataAddress(owner.address, mirrorMint, TOKEN_2022_PROGRAM_ID),
  };
}

describe('bridge out: HELIX → SPL mirror', () => {
  it('waits for graduation', async () => {
    const e = await Env.create();
    const creator = await e.wallet();
    const l = await e.launch_(creator, NO_RULES);
    const m = await mirrorAccounts(creator, l.mint);
    const err = await e.fails([ix.createMirror({ payer: creator, helixMint: l.mint, mirror: m.mirror, mirrorMint: m.mirrorMint, vault: m.vault, launch: l.launch })], creator);
    expect(err).toMatch(/BridgeNotReady/);
  });

  it('mints a Token-2022 mirror with the token’s metadata, and brings it back', async () => {
    const e = await Env.create();
    const l = await graduatedLaunch(e);
    const user = l.whale;
    const m = await mirrorAccounts(user, l.mint);
    await e.ok([ix.createMirror({ payer: user, helixMint: l.mint, mirror: m.mirror, mirrorMint: m.mirrorMint, vault: m.vault, launch: l.launch })], user);
    const md = e.data(m.mirrorMint)!;
    expect(t22Metadata(md)).toEqual({ name: 'Helix Test', symbol: 'HLXT' });
    const mm = e.svm.getAccount(m.mirrorMint);
    expect(mm.exists ? mm.programAddress : null).toBe(TOKEN_2022_PROGRAM_ID);

    const before = e.holding(m.ownerHolding).amount;
    const amount = 1_000_000_000n;
    await e.ok(
      [
        ix.createAtaIdempotent({ payer: user, ata: m.ownerToken, owner: user.address, mint: m.mirrorMint, tokenProgram: TOKEN_2022_PROGRAM_ID }),
        ix.bridgeOut(m, amount),
      ],
      user,
    );
    expect(tokenBalance(e, m.ownerToken)).toBe(amount);
    expect(e.holding(m.vault).amount).toBe(amount);
    expect(e.holding(m.ownerHolding).amount).toBe(before - amount);

    await e.ok([ix.bridgeBack(m, 400_000_000n)], user);
    expect(tokenBalance(e, m.ownerToken)).toBe(600_000_000n);
    expect(e.holding(m.vault).amount).toBe(600_000_000n);
    expect(e.holding(m.ownerHolding).amount).toBe(before - 600_000_000n);
    const x = decodeMirror(e.data(m.mirror)!);
    expect(x.totalOut).toBe(amount);
    expect(x.totalBack).toBe(400_000_000n);
    // a stranger can't bring back tokens they don't hold
    const thief = await e.wallet();
    const t = await mirrorAccounts(thief, l.mint);
    expect(await e.fails([ix.bridgeBack({ ...t, ownerToken: m.ownerToken }, 1n)], thief)).toBeTruthy();
  });

  it('keeps the vault out of holder rewards', async () => {
    const e = await Env.create();
    const l = await graduatedLaunch(e, { ...NO_RULES, holderFeeBuyBps: 200, holderFeeSellBps: 200 });
    const user = l.whale;
    const m = await mirrorAccounts(user, l.mint);
    const hook = await hookAccounts(l.mint, e.mint(l.mint));
    await e.ok([ix.createMirror({ payer: user, helixMint: l.mint, mirror: m.mirror, mirrorMint: m.mirrorMint, vault: m.vault, launch: l.launch })], user);
    expect(e.launch(l.launch).bridge).toBe(m.mirror);
    const eligible0 = e.launch(l.launch).eligible;
    const amount = 5_000_000_000n;
    await e.ok(
      [
        ix.createAtaIdempotent({ payer: user, ata: m.ownerToken, owner: user.address, mint: m.mirrorMint, tokenProgram: TOKEN_2022_PROGRAM_ID }),
        ix.bridgeOut({ ...m, hook }, amount),
      ],
      user,
    );
    expect(e.launch(l.launch).eligible).toBe(eligible0 - amount);
    // trades keep paying holders; the vault earns none of it
    const t = await e.wallet(20n * SOL);
    await e.buy(t, l, 3n * SOL);
    expect(claimableRewards(e.launch(l.launch), e.holding(m.vault), e.now)).toBe(0n);
    expect(claimableRewards(e.launch(l.launch), e.holding(m.ownerHolding), e.now)).toBeGreaterThan(0n);
    await e.ok([ix.bridgeBack({ ...m, hook }, amount)], user);
    expect(e.launch(l.launch).eligible).toBe(eligible0 + (await e.tokens(l.mint, t.address)));
  });
});
