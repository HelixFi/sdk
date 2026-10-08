/** HELIX error codes (`programs/helix/src/error.rs`), from 6000, with what each means in words. */
export const ERRORS: readonly [name: string, message: string][] = [
  ['InvalidInstruction', 'The instruction data or accounts are malformed.'],
  ['InvalidAccountOwner', 'An account is not owned by HELIX.'],
  ['InvalidAccountKind', 'An account is not the kind of HELIX account expected.'],
  ['InvalidAccountData', 'An account is too small to be a HELIX account.'],
  ['InvalidAddress', 'An account is not at the address it should be.'],
  ['MissingSignature', 'A required signature is missing.'],
  ['NotWritable', 'An account that must be writable is read-only.'],
  ['Unauthorized', 'The signer has no authority here.'],
  ['AlreadyInitialized', 'The account already exists.'],
  ['MathOverflow', 'A number overflowed.'],
  ['MintMismatch', 'A holding belongs to another token.'],
  ['OwnerMismatch', 'A holding belongs to someone else.'],
  ['InsufficientFunds', 'Not enough tokens or SOL.'],
  ['HoldingFrozen', 'The holding is frozen.'],
  ['MaxSupplyExceeded', "The mint would pass its maximum supply."],
  ['NoAuthority', 'That authority has been revoked.'],
  ['SameHolding', 'Source and destination are the same account.'],
  ['HoldingNotEmpty', 'The holding still has tokens.'],
  ['HookDataNotEmpty', 'The holding still keeps hook state (rewards owed).'],
  ['InvalidName', 'A name, symbol or link is too long or empty.'],
  ['HookProgramMismatch', "The hook program passed is not the mint's hook."],
  ['HookSignerMismatch', "The hook signer is not HELIX's signer for that hook."],
  ['HookAccountsMissing', "The hook's accounts are missing."],
  ['UnsupportedHookReturn', 'The hook answered something its flags do not allow.'],
  ['DeltaTooLarge', "The hook's cuts add up to more than the amount."],
  ['InvalidDeltaAccount', 'A hook cut names an account it may not credit.'],
  ['KitOnlyThroughLaunch', 'The built-in kit is installed only by a launch.'],
  ['Paused', 'This is paused right now (sells and withdrawals never are).'],
  ['PoolMismatch', 'The pool does not belong to this token.'],
  ['SlippageExceeded', 'The price moved past your slippage limit.'],
  ['ZeroAmount', 'The amount is zero.'],
  ['InsufficientLiquidity', 'The pool does not have enough liquidity.'],
  ['CurveLocked', 'The pool is still a bonding curve; liquidity opens at graduation.'],
  ['PoolExists', 'This token already has a pool.'],
  ['LaunchMismatch', 'The launch does not belong to this token.'],
  ['RuleOutOfBounds', 'A launch rule is outside its bounds.'],
  ['CreatorLocked', "The creator's wallet is locked until its unlock time."],
  ['EarlyBuyerLocked', 'Tokens bought in the first seconds are locked until their unlock time.'],
  ['MaxWalletExceeded', 'This would put the wallet above the max-wallet cap.'],
  ['NothingToClaim', 'There is nothing to claim.'],
  ['ShareTooSmall', 'A share must be at least 0.001 SOL.'],
  ['FeeCollectorMismatch', 'The fee collector is not the one in the config.'],
  ['ConfigOutOfBounds', 'A config value is outside its ceiling.'],
  ['UnsupportedMint', 'This token has an extension the bridge refuses (it could freeze or seize the vault), or it is already bridged.'],
  ['BridgeNotReady', 'A launch can go out through the bridge once it has graduated.'],
  ['BridgeMismatch', 'The bridge accounts do not belong to this token.'],
];

export function errorName(code: number): string | null {
  return ERRORS[code - 6000]?.[0] ?? null;
}

/** A failed transaction's logs, in words: which program failed and why. */
export function explainFailure(logs: readonly string[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = /custom program error: 0x([0-9a-f]+)/i.exec(logs[i]!);
    if (m) {
      const code = parseInt(m[1]!, 16);
      const e = ERRORS[code - 6000];
      if (e) return `${e[0]}: ${e[1]}`;
      return `Program error ${code}`;
    }
  }
  const failed = logs.findLast((l) => / failed: /.test(l));
  return failed ?? null;
}
