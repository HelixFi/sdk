import {
  AccountRole,
  getAddressEncoder,
  getUtf8Encoder,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import { ATA_PROGRAM_ID, HELIX_PROGRAM_ID, IX, SIDE, SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ZERO_ADDRESS } from './constants';

type Meta = AccountMeta | AccountSignerMeta;

const addrEnc = getAddressEncoder();
const utf8 = getUtf8Encoder();

/** Instruction-data writer (little-endian), mirroring the program's `Reader`. */
class W {
  private parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    this.parts.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }
  u32(v: number) {
    for (let i = 0; i < 4; i++) this.parts.push((v >>> (8 * i)) & 0xff);
    return this;
  }
  u64(v: bigint) {
    for (let i = 0n; i < 8n; i++) this.parts.push(Number((v >> (8n * i)) & 0xffn));
    return this;
  }
  addr(a: Address | null | undefined) {
    this.parts.push(...addrEnc.encode(a ?? ZERO_ADDRESS));
    return this;
  }
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i]!);
    return this;
  }
  str8(s: string, max: number) {
    const b = utf8.encode(s);
    if (b.length > max) throw new Error(`"${s}" is longer than ${max} bytes`);
    return this.u8(b.length).bytes(b);
  }
  str16(s: string, max: number) {
    const b = utf8.encode(s);
    if (b.length > max) throw new Error(`text is longer than ${max} bytes`);
    return this.u16(b.length).bytes(b);
  }
  done() {
    return new Uint8Array(this.parts);
  }
}

const ro = (address: Address): AccountMeta => ({ address, role: AccountRole.READONLY });
const w = (address: Address): AccountMeta => ({ address, role: AccountRole.WRITABLE });
const s = (signer: TransactionSigner): AccountSignerMeta => ({ address: signer.address, role: AccountRole.READONLY_SIGNER, signer });
const ws = (signer: TransactionSigner): AccountSignerMeta => ({ address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer });
const system = ro(SYSTEM_PROGRAM_ID);

function ix(accounts: Meta[], data: Uint8Array, programAddress: Address = HELIX_PROGRAM_ID): Instruction {
  return { programAddress, accounts, data };
}

/** Extra accounts a token operation needs for the mint's hook (see `hookAccounts`). */
export type HookMetas = readonly AccountMeta[];

// ------------------------------------------------------------------ admin

export interface ConfigParams {
  feeCollector: Address;
  launchFee: bigint;
  curveProtocolFeeBps: number;
  ammProtocolFeeBps: number;
  ammLpFeeBps: number;
  sniperStartBps: number;
  sniperWindowSecs: number;
  curveVirtualSol: bigint;
  curveVirtualTokens: bigint;
  curveSaleTokens: bigint;
  totalSupply: bigint;
}

function writeParams(d: W, p: ConfigParams) {
  return d
    .addr(p.feeCollector)
    .u64(p.launchFee)
    .u16(p.curveProtocolFeeBps)
    .u16(p.ammProtocolFeeBps)
    .u16(p.ammLpFeeBps)
    .u16(p.sniperStartBps)
    .u32(p.sniperWindowSecs)
    .u64(p.curveVirtualSol)
    .u64(p.curveVirtualTokens)
    .u64(p.curveSaleTokens)
    .u64(p.totalSupply);
}

export function initConfig(a: { authority: TransactionSigner; config: Address; programData: Address }, p: ConfigParams) {
  return ix(
    [ws(a.authority), w(a.config), ro(HELIX_PROGRAM_ID), ro(a.programData), system],
    writeParams(new W().u8(IX.initConfig), p).done(),
  );
}

export function updateConfig(
  a: { admin: TransactionSigner; config: Address },
  p: ConfigParams & { paused: number; pendingAdmin: Address | null },
) {
  return ix([s(a.admin), w(a.config)], writeParams(new W().u8(IX.updateConfig), p).u8(p.paused).addr(p.pendingAdmin).done());
}

export function acceptAdmin(a: { newAdmin: TransactionSigner; config: Address }) {
  return ix([s(a.newAdmin), w(a.config)], new W().u8(IX.acceptAdmin).done());
}

// ------------------------------------------------------------------ token standard

export interface CreateMintParams {
  decimals: number;
  hookFlags?: number;
  maxSupply?: bigint;
  mintAuthority?: Address | null;
  freezeAuthority?: Address | null;
  hookAuthority?: Address | null;
  metadataAuthority?: Address | null;
  hookProgram?: Address | null;
  name: string;
  symbol: string;
  uri?: string;
}

export function createMint(a: { payer: TransactionSigner; mint: TransactionSigner }, p: CreateMintParams) {
  const d = new W()
    .u8(IX.createMint)
    .u8(p.decimals)
    .u16(p.hookFlags ?? 0)
    .u64(p.maxSupply ?? 0n)
    .addr(p.mintAuthority)
    .addr(p.freezeAuthority)
    .addr(p.hookAuthority)
    .addr(p.metadataAuthority)
    .addr(p.hookProgram)
    .str8(p.name, 32)
    .str8(p.symbol, 16)
    .str16(p.uri ?? '', 200);
  return ix([ws(a.payer), ws(a.mint), system], d.done());
}

/** Creates `owner`'s holding of `mint` if it doesn't exist yet. Idempotent: safe to prepend. */
export function createHolding(a: { payer: TransactionSigner; holding: Address; mint: Address; owner: Address }) {
  return ix([ws(a.payer), w(a.holding), ro(a.mint), ro(a.owner), system], new W().u8(IX.createHolding).done());
}

export function transfer(
  a: { authority: TransactionSigner; source: Address; destination: Address; mint: Address; hook?: HookMetas },
  amount: bigint,
) {
  return ix(
    [s(a.authority), w(a.source), w(a.destination), ro(a.mint), ...(a.hook ?? [])],
    new W().u8(IX.transfer).u64(amount).done(),
  );
}

export function mintTo(
  a: { mintAuthority: TransactionSigner; mint: Address; destination: Address; hook?: HookMetas },
  amount: bigint,
) {
  return ix(
    [s(a.mintAuthority), w(a.mint), w(a.destination), ...(a.hook ?? [])],
    new W().u8(IX.mintTo).u64(amount).done(),
  );
}

export function burn(a: { authority: TransactionSigner; holding: Address; mint: Address; hook?: HookMetas }, amount: bigint) {
  return ix([s(a.authority), w(a.holding), w(a.mint), ...(a.hook ?? [])], new W().u8(IX.burn).u64(amount).done());
}

export function approve(a: { owner: TransactionSigner; holding: Address; delegate: Address }, amount: bigint) {
  return ix([s(a.owner), w(a.holding), ro(a.delegate)], new W().u8(IX.approve).u64(amount).done());
}

export function revoke(a: { owner: TransactionSigner; holding: Address }) {
  return ix([s(a.owner), w(a.holding)], new W().u8(IX.revoke).done());
}

export function setFrozen(a: { freezeAuthority: TransactionSigner; mint: Address; holding: Address }, frozen: boolean) {
  return ix([s(a.freezeAuthority), ro(a.mint), w(a.holding)], new W().u8(IX.setFrozen).u8(frozen ? 1 : 0).done());
}

export function closeHolding(a: { owner: TransactionSigner; holding: Address; destination: Address; mint: Address }) {
  return ix([s(a.owner), w(a.holding), w(a.destination), ro(a.mint)], new W().u8(IX.closeHolding).done());
}

/** `kind`: AUTHORITY.MINT | FREEZE | HOOK | METADATA. A null `newAuthority` revokes it for good. */
export function setAuthority(a: { current: TransactionSigner; mint: Address }, kind: number, newAuthority: Address | null) {
  return ix([s(a.current), w(a.mint)], new W().u8(IX.setAuthority).u8(kind).addr(newAuthority).done());
}

export function setHook(a: { hookAuthority: TransactionSigner; mint: Address }, hookProgram: Address | null, hookFlags: number) {
  return ix([s(a.hookAuthority), w(a.mint)], new W().u8(IX.setHook).addr(hookProgram).u16(hookFlags).done());
}

export function updateMetadata(
  a: { metadataAuthority: TransactionSigner; mint: Address },
  m: { name: string; symbol: string; uri: string },
) {
  return ix(
    [s(a.metadataAuthority), w(a.mint)],
    new W().u8(IX.updateMetadata).str8(m.name, 32).str8(m.symbol, 16).str16(m.uri, 200).done(),
  );
}

// ------------------------------------------------------------------ DEX

export interface PoolAccounts {
  mint: Address;
  pool: Address;
  poolHolding: Address;
}

/**
 * `swap`. A buy spends at most `amountIn` lamports; a sell sends `amountIn` tokens.
 * `launch` is the pool's launch (any address for a pool that is not a launch pool);
 * `hook` carries an external hook's accounts (the kit runs on `launch`).
 */
export function swap(
  a: PoolAccounts & {
    trader: TransactionSigner;
    config: Address;
    traderHolding: Address;
    launch: Address;
    hook?: HookMetas;
  },
  p: { side: 'buy' | 'sell'; amountIn: bigint; minOut: bigint },
) {
  return ix(
    [
      ws(a.trader),
      ro(a.config),
      w(a.mint),
      w(a.pool),
      w(a.poolHolding),
      w(a.traderHolding),
      w(a.launch),
      system,
      ...(a.hook ?? []),
    ],
    new W()
      .u8(IX.swap)
      .u8(p.side === 'buy' ? SIDE.BUY : SIDE.SELL)
      .u64(p.amountIn)
      .u64(p.minOut)
      .done(),
  );
}

export function createPool(
  a: PoolAccounts & { payer: TransactionSigner; config: Address; payerHolding: Address; position: Address; hook?: HookMetas },
  p: { tokenAmount: bigint; solAmount: bigint },
) {
  return ix(
    [ws(a.payer), w(a.config), w(a.mint), w(a.pool), w(a.poolHolding), w(a.payerHolding), w(a.position), system, ...(a.hook ?? [])],
    new W().u8(IX.createPool).u64(p.tokenAmount).u64(p.solAmount).done(),
  );
}

export function addLiquidity(
  a: PoolAccounts & { owner: TransactionSigner; config: Address; ownerHolding: Address; position: Address; hook?: HookMetas },
  p: { solAmount: bigint; maxTokens: bigint; minLp: bigint },
) {
  return ix(
    [ws(a.owner), ro(a.config), ro(a.mint), w(a.pool), w(a.poolHolding), w(a.ownerHolding), w(a.position), system, ...(a.hook ?? [])],
    new W().u8(IX.addLiquidity).u64(p.solAmount).u64(p.maxTokens).u64(p.minLp).done(),
  );
}

export function removeLiquidity(
  a: PoolAccounts & { owner: TransactionSigner; ownerHolding: Address; position: Address; hook?: HookMetas },
  p: { lp: bigint; minSol: bigint; minTokens: bigint },
) {
  return ix(
    [ws(a.owner), ro(a.mint), w(a.pool), w(a.poolHolding), w(a.ownerHolding), w(a.position), ...(a.hook ?? [])],
    new W().u8(IX.removeLiquidity).u64(p.lp).u64(p.minSol).u64(p.minTokens).done(),
  );
}

export function collectProtocolFees(a: { config: Address; pool: Address; feeCollector: Address }) {
  return ix([ro(a.config), w(a.pool), w(a.feeCollector)], new W().u8(IX.collectProtocolFees).done());
}

// ------------------------------------------------------------------ launchpad

export interface LaunchRules {
  creatorFeeBps: number;
  holderFeeBuyBps: number;
  holderFeeSellBps: number;
  burnBuyBps: number;
  burnSellBps: number;
  /** 0: off, else 50..500 (0.5% to 5% of supply), until graduation. */
  maxWalletBps: number;
  creatorLockSecs: number;
  earlyWindowSecs: number;
  earlyLockSecs: number;
}

export const NO_RULES: LaunchRules = {
  creatorFeeBps: 0,
  holderFeeBuyBps: 0,
  holderFeeSellBps: 0,
  burnBuyBps: 0,
  burnSellBps: 0,
  maxWalletBps: 0,
  creatorLockSecs: 0,
  earlyWindowSecs: 0,
  earlyLockSecs: 0,
};

export function createLaunch(
  a: {
    creator: TransactionSigner;
    config: Address;
    mint: TransactionSigner;
    pool: Address;
    poolHolding: Address;
    launch: Address;
    feeCollector: Address;
    hook?: HookMetas;
  },
  p: { name: string; symbol: string; uri: string; rules: LaunchRules; customHook?: Address | null; customHookFlags?: number },
) {
  const r = p.rules;
  const d = new W()
    .u8(IX.createLaunch)
    .str8(p.name, 32)
    .str8(p.symbol, 16)
    .str16(p.uri, 200)
    .u16(r.creatorFeeBps)
    .u16(r.holderFeeBuyBps)
    .u16(r.holderFeeSellBps)
    .u16(r.burnBuyBps)
    .u16(r.burnSellBps)
    .u16(r.maxWalletBps)
    .u32(r.creatorLockSecs)
    .u32(r.earlyWindowSecs)
    .u32(r.earlyLockSecs)
    .addr(p.customHook)
    .u16(p.customHookFlags ?? 0);
  return ix(
    [
      ws(a.creator),
      w(a.config),
      ws(a.mint),
      w(a.pool),
      w(a.poolHolding),
      w(a.launch),
      w(a.feeCollector),
      system,
      ...(a.hook ?? []),
    ],
    d.done(),
  );
}

export function claimCreatorFees(a: { creator: TransactionSigner; launch: Address }) {
  return ix([ws(a.creator), w(a.launch)], new W().u8(IX.claimCreatorFees).done());
}

export function claimRewards(a: { owner: TransactionSigner; mint: Address; launch: Address; holding: Address }) {
  return ix([ws(a.owner), ro(a.mint), w(a.launch), w(a.holding)], new W().u8(IX.claimRewards).done());
}

export function shareWithHolders(a: { payer: TransactionSigner; launch: Address }, lamports: bigint) {
  return ix([ws(a.payer), w(a.launch), system], new W().u8(IX.shareWithHolders).u64(lamports).done());
}

// ------------------------------------------------------------------ bridge

/** Bridge in, once per mint: the wrapper, its HELIX mint and its vault (the wrapper's ATA). */
export function registerWrapper(a: {
  payer: TransactionSigner;
  splMint: Address;
  tokenProgram: Address;
  wrapper: Address;
  helixMint: Address;
  vault: Address;
  /** The mint's Metaplex metadata account (any address if it has none). */
  metaplexMetadata: Address;
}) {
  return ix(
    [ws(a.payer), ro(a.splMint), ro(a.tokenProgram), w(a.wrapper), w(a.helixMint), w(a.vault), ro(ATA_PROGRAM_ID), system, ro(a.metaplexMetadata)],
    new W().u8(IX.registerWrapper).done(),
  );
}

export interface WrapAccounts {
  owner: TransactionSigner;
  splMint: Address;
  tokenProgram: Address;
  wrapper: Address;
  helixMint: Address;
  vault: Address;
  ownerToken: Address;
  ownerHolding: Address;
}

const wrapMetas = (a: WrapAccounts): Meta[] => [
  s(a.owner),
  ro(a.splMint),
  ro(a.tokenProgram),
  w(a.wrapper),
  w(a.helixMint),
  w(a.vault),
  w(a.ownerToken),
  w(a.ownerHolding),
];

/** SPL / Token-2022 → HELIX, one for one. */
export function wrap(a: WrapAccounts, amount: bigint) {
  return ix(wrapMetas(a), new W().u8(IX.wrap).u64(amount).done());
}

/** HELIX → the original token, one for one. */
export function unwrap(a: WrapAccounts, amount: bigint) {
  return ix(wrapMetas(a), new W().u8(IX.unwrap).u64(amount).done());
}

/** Bridge out, once per mint: the mirror and its Token-2022 mint. `launch`: the token's launch (any address if none). */
export function createMirror(a: { payer: TransactionSigner; helixMint: Address; mirror: Address; mirrorMint: Address; vault: Address; launch: Address }) {
  return ix(
    [ws(a.payer), ro(a.helixMint), w(a.mirror), w(a.mirrorMint), w(a.vault), ro(TOKEN_2022_PROGRAM_ID), system, w(a.launch)],
    new W().u8(IX.createMirror).done(),
  );
}

export interface MirrorAccounts {
  owner: TransactionSigner;
  helixMint: Address;
  mirror: Address;
  mirrorMint: Address;
  vault: Address;
  ownerHolding: Address;
  /** The owner's Token-2022 account for the mirror mint (its ATA). */
  ownerToken: Address;
  hook?: HookMetas;
}

const mirrorMetas = (a: MirrorAccounts): Meta[] => [
  ws(a.owner),
  w(a.helixMint),
  w(a.mirror),
  w(a.mirrorMint),
  w(a.vault),
  w(a.ownerHolding),
  w(a.ownerToken),
  ro(TOKEN_2022_PROGRAM_ID),
  ...(a.hook ?? []),
];

/** HELIX → its SPL mirror. */
export function bridgeOut(a: MirrorAccounts, amount: bigint) {
  return ix(mirrorMetas(a), new W().u8(IX.bridgeOut).u64(amount).done());
}

/** The SPL mirror → HELIX. */
export function bridgeBack(a: MirrorAccounts, amount: bigint) {
  return ix(mirrorMetas(a), new W().u8(IX.bridgeBack).u64(amount).done());
}

/** The associated token account program's `CreateIdempotent`. */
export function createAtaIdempotent(a: { payer: TransactionSigner; ata: Address; owner: Address; mint: Address; tokenProgram: Address }) {
  return ix([ws(a.payer), w(a.ata), ro(a.owner), ro(a.mint), system, ro(a.tokenProgram)], new Uint8Array([1]), ATA_PROGRAM_ID);
}

// ------------------------------------------------------------------ example hook (trade_tax)

const TAX_INIT = [220, 59, 207, 236, 108, 250, 47, 100];

/** `trade_tax.init`: the hook's config for one mint (`["tax", mint]` under the hook program). */
export function exampleHookInit(
  a: { payer: TransactionSigner; config: Address; mint: Address; hookProgram: Address },
  p: { feeBps: number; collectorOwner: Address; collectorHolding: Address },
) {
  return ix(
    [ws(a.payer), w(a.config), ro(a.mint), system],
    new W().bytes(TAX_INIT).u16(p.feeBps).addr(p.collectorOwner).addr(p.collectorHolding).done(),
    a.hookProgram,
  );
}
