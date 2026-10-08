import { address, type Address } from '@solana/kit';

/** The HELIX program: token standard, DEX, launchpad and bridge in one. Same id on every cluster. */
export const HELIX_PROGRAM_ID: Address = address('HLX49qz3CSKQrHrdzrrWygZBaKHWWSG8JwUMFHcZ47Fr');
/** `trade_tax`, the example token hook (programs/example-hook). */
export const EXAMPLE_HOOK_PROGRAM_ID: Address = address('AvY5wRP672DpNod6TWvMcNx9ekjgxoBjmj42ijbHenhz');
export const SYSTEM_PROGRAM_ID: Address = address('11111111111111111111111111111111');
export const LOADER_UPGRADEABLE_ID: Address = address('BPFLoaderUpgradeab1e11111111111111111111111');
export const TOKEN_PROGRAM_ID: Address = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID: Address = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ATA_PROGRAM_ID: Address = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const METAPLEX_PROGRAM_ID: Address = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const ZERO_ADDRESS: Address = SYSTEM_PROGRAM_ID;

/** Instruction tags: the first byte of instruction data. Mirrors `programs/helix/src/lib.rs`. */
export const IX = {
  initConfig: 0,
  updateConfig: 1,
  acceptAdmin: 2,
  createMint: 10,
  createHolding: 11,
  transfer: 12,
  mintTo: 13,
  burn: 14,
  approve: 15,
  revoke: 16,
  setFrozen: 17,
  closeHolding: 18,
  setAuthority: 19,
  setHook: 20,
  updateMetadata: 21,
  writeHookData: 22,
  createPool: 30,
  addLiquidity: 31,
  removeLiquidity: 32,
  swap: 33,
  collectProtocolFees: 34,
  createLaunch: 40,
  claimCreatorFees: 41,
  claimRewards: 42,
  shareWithHolders: 43,
  registerWrapper: 50,
  wrap: 51,
  unwrap: 52,
  createMirror: 53,
  bridgeOut: 54,
  bridgeBack: 55,
} as const;

/** Account kinds: the first byte of every HELIX account. */
export const KIND = { config: 1, mint: 2, holding: 3, pool: 4, launch: 5, position: 6, wrapper: 7, mirror: 8 } as const;

/** Account sizes in bytes. */
export const SIZE = { config: 240, mint: 448, holding: 184, pool: 216, launch: 320, position: 96, wrapper: 192, mirror: 160 } as const;

/** `Mint.hook_flags`. */
export const HOOK_FLAGS = {
  BEFORE_TRANSFER: 1 << 0,
  AFTER_TRANSFER: 1 << 1,
  BEFORE_MINT: 1 << 2,
  AFTER_MINT: 1 << 3,
  BEFORE_BURN: 1 << 4,
  AFTER_BURN: 1 << 5,
  TRANSFER_RETURNS_DELTA: 1 << 6,
  WRITES_HOOK_DATA: 1 << 7,
} as const;

/** `Launch.rules` bits. */
export const RULES = {
  HOLDER_REWARDS: 1,
  MAX_WALLET: 2,
  CREATOR_LOCK: 4,
  EARLY_LOCK: 8,
  CUSTOM_HOOK: 16,
} as const;
export const KIT_RULES = RULES.HOLDER_REWARDS | RULES.MAX_WALLET | RULES.CREATOR_LOCK | RULES.EARLY_LOCK;

export const MINT_FLAGS = { KIT: 1, LAUNCH: 2, BRIDGED: 4 } as const;
export const PAUSE = { LAUNCHES: 1, BUYS: 2, POOLS: 4 } as const;
export const MODE = { CURVE: 0, AMM: 1 } as const;
export const LAUNCH_STATE = { CURVE: 0, GRADUATED: 1 } as const;
export const SIDE = { BUY: 0, SELL: 1 } as const;
export const AUTHORITY = { MINT: 0, FREEZE: 1, HOOK: 2, METADATA: 3 } as const;
/** Why tokens move, as a hook is told. */
export const CONTEXT = { PLAIN: 0, BUY: 1, SELL: 2, LIQUIDITY: 3, BRIDGE: 4 } as const;

export const BPS = 10_000n;
export const SCALE = 10n ** 18n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const LAUNCH_DECIMALS = 6;
export const MIN_LIQUIDITY = 1_000n;
export const HOOK_DATA_LEN = 64;

/** Bounds of a launch's rules (`programs/helix/src/launch.rs`). */
export const BOUNDS = {
  creatorFeeBps: 200,
  holderFeeBps: 300,
  burnBps: 200,
  sideTotalBps: 500,
  maxWalletMinBps: 50,
  maxWalletMaxBps: 500,
  creatorLockSecs: 365 * 86_400,
  earlyWindowSecs: 300,
  earlyLockSecs: 30 * 86_400,
  minShareLamports: 1_000_000n,
} as const;

/** Ceilings the admin can never exceed (`programs/helix/src/state.rs`). */
export const CEILINGS = {
  curveProtocolFeeBps: 150,
  ammProtocolFeeBps: 50,
  ammLpFeeBps: 100,
  sniperStartBps: 5_000,
  sniperWindowSecs: 60,
  launchFee: 100_000_000n,
} as const;

/**
 * The config HELIX launches with. Supply 1B (6 decimals); 790M sold on the curve, 210M set aside
 * for the AMM. The curve opens at 30 SOL of virtual liquidity (≈28 SOL market cap) and graduates
 * when the 790M are sold, at ≈83.7 SOL raised.
 */
export const DEFAULT_CONFIG = {
  launchFee: 10_000_000n,
  curveProtocolFeeBps: 50,
  ammProtocolFeeBps: 5,
  ammLpFeeBps: 25,
  sniperStartBps: 3_000,
  sniperWindowSecs: 20,
  curveVirtualSol: 30n * LAMPORTS_PER_SOL,
  curveVirtualTokens: 1_073_000_000n * 10n ** 6n,
  curveSaleTokens: 790_000_000n * 10n ** 6n,
  totalSupply: 1_000_000_000n * 10n ** 6n,
} as const;

/** Anchor discriminators of the hook callbacks, `sha256("global:<name>")[..8]`. */
export const HOOK_DISC = {
  beforeTransfer: [23, 118, 189, 23, 179, 222, 94, 146],
  afterTransfer: [153, 128, 220, 5, 209, 90, 39, 89],
  beforeMint: [67, 27, 57, 7, 28, 168, 109, 153],
  afterMint: [134, 114, 182, 161, 82, 69, 14, 154],
  beforeBurn: [7, 177, 19, 160, 28, 229, 57, 73],
  afterBurn: [6, 153, 69, 120, 1, 248, 63, 0],
} as const;
