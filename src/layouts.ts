import { getAddressDecoder, type Address } from '@solana/kit';
import { KIND, SIZE, ZERO_ADDRESS } from './constants';

const addr = getAddressDecoder();
const text = new TextDecoder();

/** Little-endian reader at fixed offsets, mirroring the packed Rust layouts. */
class R {
  private v: DataView;
  constructor(private b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8(o: number) {
    return this.v.getUint8(o);
  }
  u16(o: number) {
    return this.v.getUint16(o, true);
  }
  u32(o: number) {
    return this.v.getUint32(o, true);
  }
  u64(o: number) {
    return this.v.getBigUint64(o, true);
  }
  i64(o: number) {
    return this.v.getBigInt64(o, true);
  }
  u128(o: number) {
    return this.u64(o) + (this.u64(o + 8) << 64n);
  }
  addr(o: number): Address {
    return addr.decode(this.b.subarray(o, o + 32));
  }
  bytes(o: number, n: number) {
    return this.b.slice(o, o + n);
  }
  str(o: number, n: number) {
    return text.decode(this.b.subarray(o, o + n));
  }
}

function check(data: Uint8Array, kind: number, size: number, what: string) {
  if (data.length < size || data[0] !== kind) throw new Error(`not a HELIX ${what} account`);
  return new R(data);
}

const opt = (a: Address): Address | null => (a === ZERO_ADDRESS ? null : a);

export interface Config {
  bump: number;
  paused: number;
  admin: Address;
  pendingAdmin: Address | null;
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
  totalLaunches: bigint;
  totalPools: bigint;
}

export function decodeConfig(data: Uint8Array): Config {
  const r = check(data, KIND.config, SIZE.config, 'config');
  return {
    bump: r.u8(1),
    paused: r.u8(2),
    admin: r.addr(8),
    pendingAdmin: opt(r.addr(40)),
    feeCollector: r.addr(72),
    launchFee: r.u64(104),
    curveProtocolFeeBps: r.u16(112),
    ammProtocolFeeBps: r.u16(114),
    ammLpFeeBps: r.u16(116),
    sniperStartBps: r.u16(118),
    sniperWindowSecs: r.u32(120),
    curveVirtualSol: r.u64(128),
    curveVirtualTokens: r.u64(136),
    curveSaleTokens: r.u64(144),
    totalSupply: r.u64(152),
    totalLaunches: r.u64(160),
    totalPools: r.u64(168),
  };
}

export interface Mint {
  decimals: number;
  flags: number;
  hookFlags: number;
  supply: bigint;
  maxSupply: bigint;
  mintAuthority: Address | null;
  freezeAuthority: Address | null;
  hookAuthority: Address | null;
  metadataAuthority: Address | null;
  /** Null: no hook. The HELIX program id: the built-in kit. */
  hookProgram: Address | null;
  createdAt: bigint;
  name: string;
  symbol: string;
  uri: string;
}

export function decodeMint(data: Uint8Array): Mint {
  const r = check(data, KIND.mint, SIZE.mint, 'mint');
  return {
    decimals: r.u8(1),
    flags: r.u8(2),
    hookFlags: r.u16(6),
    supply: r.u64(8),
    maxSupply: r.u64(16),
    mintAuthority: opt(r.addr(24)),
    freezeAuthority: opt(r.addr(56)),
    hookAuthority: opt(r.addr(88)),
    metadataAuthority: opt(r.addr(120)),
    hookProgram: opt(r.addr(152)),
    createdAt: r.i64(184),
    name: r.str(200, r.u8(3)),
    symbol: r.str(232, r.u8(4)),
    uri: r.str(248, r.u16(192)),
  };
}

export interface Holding {
  bump: number;
  frozen: boolean;
  mint: Address;
  owner: Address;
  amount: bigint;
  delegate: Address | null;
  delegatedAmount: bigint;
  hookData: Uint8Array;
}

export function decodeHolding(data: Uint8Array): Holding {
  const r = check(data, KIND.holding, SIZE.holding, 'holding');
  return {
    bump: r.u8(1),
    frozen: r.u8(2) !== 0,
    mint: r.addr(8),
    owner: r.addr(40),
    amount: r.u64(72),
    delegate: opt(r.addr(80)),
    delegatedAmount: r.u64(112),
    hookData: r.bytes(120, 64),
  };
}

/** The kit's 64 bytes: reward snapshot, rewards owed, tokens locked as an early buyer. */
export function decodeKitHookData(d: Uint8Array) {
  const r = new R(d);
  return { snapshot: r.u128(0), owed: r.u64(16), earlyLocked: r.u64(24) };
}

export interface Pool {
  bump: number;
  mode: number;
  mint: Address;
  launch: Address | null;
  tokenReserve: bigint;
  solReserve: bigint;
  virtualSol: bigint;
  virtualTokens: bigint;
  graduationTokens: bigint;
  bonusSol: bigint;
  protocolFees: bigint;
  lpSupply: bigint;
  lockedLp: bigint;
  protocolFeeBps: number;
  lpFeeBps: number;
  gradProtocolFeeBps: number;
  gradLpFeeBps: number;
  createdAt: bigint;
  graduatedAt: bigint;
  volumeSol: bigint;
  trades: bigint;
}

export function decodePool(data: Uint8Array): Pool {
  const r = check(data, KIND.pool, SIZE.pool, 'pool');
  return {
    bump: r.u8(1),
    mode: r.u8(2),
    mint: r.addr(8),
    launch: opt(r.addr(40)),
    tokenReserve: r.u64(72),
    solReserve: r.u64(80),
    virtualSol: r.u64(88),
    virtualTokens: r.u64(96),
    graduationTokens: r.u64(104),
    bonusSol: r.u64(112),
    protocolFees: r.u64(120),
    lpSupply: r.u64(128),
    lockedLp: r.u64(136),
    protocolFeeBps: r.u16(144),
    lpFeeBps: r.u16(146),
    gradProtocolFeeBps: r.u16(148),
    gradLpFeeBps: r.u16(150),
    createdAt: r.i64(152),
    graduatedAt: r.i64(160),
    volumeSol: r.u64(168),
    trades: r.u64(176),
  };
}

export interface Launch {
  bump: number;
  state: number;
  rules: number;
  creatorFirstBuy: boolean;
  mint: Address;
  creator: Address;
  pool: Address;
  creatorFeeBps: number;
  holderFeeBuyBps: number;
  holderFeeSellBps: number;
  burnBuyBps: number;
  burnSellBps: number;
  maxWalletBps: number;
  sniperStartBps: number;
  sniperWindowSecs: number;
  createdAt: bigint;
  graduatedAt: bigint;
  creatorUnlockAt: bigint;
  earlyWindowEnd: bigint;
  earlyUnlockAt: bigint;
  maxWalletAmount: bigint;
  creatorFeesTotal: bigint;
  creatorFeesClaimed: bigint;
  accPerShare: bigint;
  rem: bigint;
  eligible: bigint;
  minEligible: bigint;
  held: bigint;
  rewardsIn: bigint;
  rewardsClaimed: bigint;
  streamTotal: bigint;
  streamReleased: bigint;
  streamStart: bigint;
  streamEnd: bigint;
  /** The bridge's mirror authority once the token has an SPL mirror. */
  bridge: Address | null;
}

export function decodeLaunch(data: Uint8Array): Launch {
  const r = check(data, KIND.launch, SIZE.launch, 'launch');
  return {
    bump: r.u8(1),
    state: r.u8(2),
    rules: r.u8(3),
    creatorFirstBuy: r.u8(4) !== 0,
    mint: r.addr(8),
    creator: r.addr(40),
    pool: r.addr(72),
    creatorFeeBps: r.u16(104),
    holderFeeBuyBps: r.u16(106),
    holderFeeSellBps: r.u16(108),
    burnBuyBps: r.u16(110),
    burnSellBps: r.u16(112),
    maxWalletBps: r.u16(114),
    sniperStartBps: r.u16(116),
    sniperWindowSecs: r.u16(118),
    createdAt: r.i64(120),
    graduatedAt: r.i64(128),
    creatorUnlockAt: r.i64(136),
    earlyWindowEnd: r.i64(144),
    earlyUnlockAt: r.i64(152),
    maxWalletAmount: r.u64(160),
    creatorFeesTotal: r.u64(168),
    creatorFeesClaimed: r.u64(176),
    accPerShare: r.u128(184),
    rem: r.u128(200),
    eligible: r.u64(216),
    minEligible: r.u64(224),
    held: r.u64(232),
    rewardsIn: r.u64(240),
    rewardsClaimed: r.u64(248),
    streamTotal: r.u64(256),
    streamReleased: r.u64(264),
    streamStart: r.i64(272),
    streamEnd: r.i64(280),
    bridge: opt(r.addr(288)),
  };
}

export interface Position {
  bump: number;
  pool: Address;
  owner: Address;
  lp: bigint;
}

export function decodePosition(data: Uint8Array): Position {
  const r = check(data, KIND.position, SIZE.position, 'position');
  return { bump: r.u8(1), pool: r.addr(8), owner: r.addr(40), lp: r.u64(72) };
}

export interface Wrapper {
  bump: number;
  decimals: number;
  splMint: Address;
  tokenProgram: Address;
  helixMint: Address;
  vault: Address;
  totalIn: bigint;
  totalOut: bigint;
  createdAt: bigint;
}

export function decodeWrapper(data: Uint8Array): Wrapper {
  const r = check(data, KIND.wrapper, SIZE.wrapper, 'wrapper');
  return {
    bump: r.u8(1),
    decimals: r.u8(2),
    splMint: r.addr(8),
    tokenProgram: r.addr(40),
    helixMint: r.addr(72),
    vault: r.addr(104),
    totalIn: r.u64(136),
    totalOut: r.u64(144),
    createdAt: r.i64(152),
  };
}

export interface Mirror {
  bump: number;
  decimals: number;
  helixMint: Address;
  splMint: Address;
  vault: Address;
  totalOut: bigint;
  totalBack: bigint;
  createdAt: bigint;
}

export function decodeMirror(data: Uint8Array): Mirror {
  const r = check(data, KIND.mirror, SIZE.mirror, 'mirror');
  return {
    bump: r.u8(1),
    decimals: r.u8(3),
    helixMint: r.addr(8),
    splMint: r.addr(40),
    vault: r.addr(72),
    totalOut: r.u64(104),
    totalBack: r.u64(112),
    createdAt: r.i64(120),
  };
}

/** A token account's mint, owner and amount (SPL Token and Token-2022 share this layout). */
export function decodeTokenAccount(data: Uint8Array) {
  const r = new R(data);
  return { mint: r.addr(0), owner: r.addr(32), amount: r.u64(64) };
}

/** Byte offsets used by `getProgramAccounts` filters. */
export const OFFSETS = {
  holding: { mint: 8, owner: 40, amount: 72 },
  pool: { mint: 8, launch: 40 },
  launch: { mint: 8, creator: 40 },
  position: { pool: 8, owner: 40 },
} as const;
