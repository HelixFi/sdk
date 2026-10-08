import {
  AccountRole,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type AccountMeta,
  type Address,
} from '@solana/kit';
import { HELIX_PROGRAM_ID } from './constants';
import type { Mint } from './layouts';
import { hookSignerAddress, launchAddress } from './pda';

export type HookKind = 'none' | 'kit' | 'external';

export function hookKind(mint: Pick<Mint, 'hookProgram'>): HookKind {
  if (!mint.hookProgram) return 'none';
  return mint.hookProgram === HELIX_PROGRAM_ID ? 'kit' : 'external';
}

/**
 * Accounts a token operation (transfer, mint, burn, liquidity) appends for the mint's hook:
 * none; `[launch]` for the kit; `[hook_program, hook_signer, ...extras]` for an external hook.
 */
export async function hookAccounts(
  mintAddress: Address,
  mint: Pick<Mint, 'hookProgram'>,
  extras: readonly AccountMeta[] = [],
): Promise<AccountMeta[]> {
  const kind = hookKind(mint);
  if (kind === 'none') return [];
  if (kind === 'kit') return [{ address: await launchAddress(mintAddress), role: AccountRole.WRITABLE }];
  return externalHookAccounts(mint.hookProgram!, extras);
}

/** The accounts a swap appends: an external hook's only (the kit runs on the swap's own launch account). */
export async function swapHookAccounts(mint: Pick<Mint, 'hookProgram'>, extras: readonly AccountMeta[] = []): Promise<AccountMeta[]> {
  return hookKind(mint) === 'external' ? externalHookAccounts(mint.hookProgram!, extras) : [];
}

async function externalHookAccounts(program: Address, extras: readonly AccountMeta[]): Promise<AccountMeta[]> {
  return [
    { address: program, role: AccountRole.READONLY },
    { address: await hookSignerAddress(program), role: AccountRole.READONLY },
    ...extras,
  ];
}

const addrDec = getAddressDecoder();

/**
 * A hook's published extra accounts, read from `PDA(["extra-accounts", mint], hook_program)`:
 * `[count u8, (writable u8, address [32]) × count]`.
 */
export function decodeExtraAccounts(data: Uint8Array): AccountMeta[] {
  const out: AccountMeta[] = [];
  const n = data[0] ?? 0;
  for (let i = 0; i < n; i++) {
    const o = 1 + i * 33;
    out.push({
      address: addrDec.decode(data.subarray(o + 1, o + 33)),
      role: data[o] === 1 ? AccountRole.WRITABLE : AccountRole.READONLY,
    });
  }
  return out;
}

/** The example hook's (trade_tax) extras for a mint: its config, then the collector's holding. */
export async function exampleHookExtras(hookProgram: Address, mint: Address, collectorHolding: Address): Promise<AccountMeta[]> {
  return [
    { address: await exampleHookConfigAddress(hookProgram, mint), role: AccountRole.READONLY },
    { address: collectorHolding, role: AccountRole.WRITABLE },
  ];
}

export async function exampleHookConfigAddress(hookProgram: Address, mint: Address): Promise<Address> {
  const [config] = await getProgramDerivedAddress({
    programAddress: hookProgram,
    seeds: [getUtf8Encoder().encode('tax'), getAddressEncoder().encode(mint)],
  });
  return config;
}
