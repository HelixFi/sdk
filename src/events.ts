/**
 * HELIX events: emitted as program log data (`Program data: <base64>`), `[kind, fields...]`.
 * `parseEvents` keeps only data logged while HELIX itself was executing.
 */
import { getAddressDecoder, getBase64Encoder, type Address } from '@solana/kit';
import { HELIX_PROGRAM_ID } from './constants';

const b64 = getBase64Encoder();
const addr = getAddressDecoder();

export const EVENT = {
  transfer: 1,
  mintTo: 2,
  burn: 3,
  swap: 4,
  launchCreated: 5,
  graduated: 6,
  poolCreated: 7,
  liquidity: 8,
  rewardsClaimed: 9,
  shared: 10,
  creatorClaimed: 11,
  protocolCollected: 12,
  mintCreated: 13,
  configUpdated: 14,
  wrapperCreated: 15,
  wrapped: 16,
  unwrapped: 17,
  mirrorCreated: 18,
  bridgedOut: 19,
  bridgedBack: 20,
} as const;

export type HelixEvent =
  | { kind: 'transfer'; mint: Address; from: Address; to: Address; authority: Address; amount: bigint; cut: bigint; context: number }
  | { kind: 'mintTo'; mint: Address; to: Address; amount: bigint }
  | { kind: 'burn'; mint: Address; from: Address; amount: bigint }
  | {
      kind: 'swap';
      mint: Address;
      trader: Address;
      side: 'buy' | 'sell';
      /** Lamports the trader paid (buy) or received (sell). */
      sol: bigint;
      /** Tokens the trader received (buy) or sent (sell). */
      tokens: bigint;
      protocolFee: bigint;
      creatorFee: bigint;
      holderFee: bigint;
      sniperFee: bigint;
      burned: bigint;
      /** Price reserves after the trade: virtual on the curve, real on the AMM. */
      reserveSol: bigint;
      reserveTokens: bigint;
      mode: number;
      timestamp: bigint;
    }
  | {
      kind: 'launchCreated';
      mint: Address;
      creator: Address;
      pool: Address;
      hookProgram: Address;
      rules: number;
      creatorFeeBps: number;
      holderFeeBuyBps: number;
      holderFeeSellBps: number;
      burnBuyBps: number;
      burnSellBps: number;
      maxWalletBps: number;
      creatorUnlockAt: bigint;
      earlyWindowEnd: bigint;
      earlyUnlockAt: bigint;
      timestamp: bigint;
    }
  | { kind: 'graduated'; mint: Address; sol: bigint; tokens: bigint; burned: bigint; timestamp: bigint }
  | { kind: 'poolCreated'; mint: Address; creator: Address; tokens: bigint; sol: bigint; lp: bigint }
  | { kind: 'liquidity'; mint: Address; owner: Address; removed: boolean; sol: bigint; tokens: bigint; lp: bigint }
  | { kind: 'rewardsClaimed'; mint: Address; owner: Address; lamports: bigint }
  | { kind: 'shared'; mint: Address; from: Address; lamports: bigint }
  | { kind: 'creatorClaimed'; mint: Address; creator: Address; lamports: bigint }
  | { kind: 'protocolCollected'; mint: Address; lamports: bigint }
  | { kind: 'mintCreated'; mint: Address; payer: Address; hookProgram: Address }
  | { kind: 'configUpdated'; by: Address }
  | { kind: 'wrapperCreated'; splMint: Address; mint: Address; by: Address }
  | { kind: 'wrapped'; splMint: Address; owner: Address; amount: bigint }
  | { kind: 'unwrapped'; splMint: Address; owner: Address; amount: bigint }
  | { kind: 'mirrorCreated'; mint: Address; mirrorMint: Address; by: Address }
  | { kind: 'bridgedOut'; mint: Address; owner: Address; amount: bigint }
  | { kind: 'bridgedBack'; mint: Address; owner: Address; amount: bigint };

class R {
  private o = 1;
  private v: DataView;
  constructor(private b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  a(): Address {
    const x = addr.decode(this.b.subarray(this.o, this.o + 32));
    this.o += 32;
    return x;
  }
  u8() {
    return this.v.getUint8(this.o++);
  }
  u16() {
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
  }
  u64() {
    const x = this.v.getBigUint64(this.o, true);
    this.o += 8;
    return x;
  }
  i64() {
    const x = this.v.getBigInt64(this.o, true);
    this.o += 8;
    return x;
  }
}

export function decodeEvent(data: Uint8Array): HelixEvent | null {
  const r = new R(data);
  switch (data[0]) {
    case EVENT.transfer:
      return { kind: 'transfer', mint: r.a(), from: r.a(), to: r.a(), authority: r.a(), amount: r.u64(), cut: r.u64(), context: r.u8() };
    case EVENT.mintTo:
      return { kind: 'mintTo', mint: r.a(), to: r.a(), amount: r.u64() };
    case EVENT.burn:
      return { kind: 'burn', mint: r.a(), from: r.a(), amount: r.u64() };
    case EVENT.swap:
      return {
        kind: 'swap',
        mint: r.a(),
        trader: r.a(),
        side: r.u8() === 0 ? 'buy' : 'sell',
        sol: r.u64(),
        tokens: r.u64(),
        protocolFee: r.u64(),
        creatorFee: r.u64(),
        holderFee: r.u64(),
        sniperFee: r.u64(),
        burned: r.u64(),
        reserveSol: r.u64(),
        reserveTokens: r.u64(),
        mode: r.u8(),
        timestamp: r.i64(),
      };
    case EVENT.launchCreated:
      return {
        kind: 'launchCreated',
        mint: r.a(),
        creator: r.a(),
        pool: r.a(),
        hookProgram: r.a(),
        rules: r.u8(),
        creatorFeeBps: r.u16(),
        holderFeeBuyBps: r.u16(),
        holderFeeSellBps: r.u16(),
        burnBuyBps: r.u16(),
        burnSellBps: r.u16(),
        maxWalletBps: r.u16(),
        creatorUnlockAt: r.i64(),
        earlyWindowEnd: r.i64(),
        earlyUnlockAt: r.i64(),
        timestamp: r.i64(),
      };
    case EVENT.graduated:
      return { kind: 'graduated', mint: r.a(), sol: r.u64(), tokens: r.u64(), burned: r.u64(), timestamp: r.i64() };
    case EVENT.poolCreated:
      return { kind: 'poolCreated', mint: r.a(), creator: r.a(), tokens: r.u64(), sol: r.u64(), lp: r.u64() };
    case EVENT.liquidity:
      return { kind: 'liquidity', mint: r.a(), owner: r.a(), removed: r.u8() === 1, sol: r.u64(), tokens: r.u64(), lp: r.u64() };
    case EVENT.rewardsClaimed:
      return { kind: 'rewardsClaimed', mint: r.a(), owner: r.a(), lamports: r.u64() };
    case EVENT.shared:
      return { kind: 'shared', mint: r.a(), from: r.a(), lamports: r.u64() };
    case EVENT.creatorClaimed:
      return { kind: 'creatorClaimed', mint: r.a(), creator: r.a(), lamports: r.u64() };
    case EVENT.protocolCollected:
      return { kind: 'protocolCollected', mint: r.a(), lamports: r.u64() };
    case EVENT.mintCreated:
      return { kind: 'mintCreated', mint: r.a(), payer: r.a(), hookProgram: r.a() };
    case EVENT.configUpdated:
      return { kind: 'configUpdated', by: r.a() };
    case EVENT.wrapperCreated:
      return { kind: 'wrapperCreated', splMint: r.a(), mint: r.a(), by: r.a() };
    case EVENT.wrapped:
      return { kind: 'wrapped', splMint: r.a(), owner: r.a(), amount: r.u64() };
    case EVENT.unwrapped:
      return { kind: 'unwrapped', splMint: r.a(), owner: r.a(), amount: r.u64() };
    case EVENT.mirrorCreated:
      return { kind: 'mirrorCreated', mint: r.a(), mirrorMint: r.a(), by: r.a() };
    case EVENT.bridgedOut:
      return { kind: 'bridgedOut', mint: r.a(), owner: r.a(), amount: r.u64() };
    case EVENT.bridgedBack:
      return { kind: 'bridgedBack', mint: r.a(), owner: r.a(), amount: r.u64() };
    default:
      return null;
  }
}

/** HELIX events from a transaction's logs, in order. */
export function parseEvents(logs: readonly string[], programId: Address = HELIX_PROGRAM_ID): HelixEvent[] {
  const stack: string[] = [];
  const out: HelixEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith('Program data: ') && stack[stack.length - 1] === programId) {
      for (const part of line.slice('Program data: '.length).split(' ')) {
        const e = decodeEvent(new Uint8Array(b64.encode(part)));
        if (e) out.push(e);
      }
    }
  }
  return out;
}
