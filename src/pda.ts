import { getAddressEncoder, getProgramDerivedAddress, getUtf8Encoder, type Address } from '@solana/kit';
import { ATA_PROGRAM_ID, HELIX_PROGRAM_ID, LOADER_UPGRADEABLE_ID, METAPLEX_PROGRAM_ID, TOKEN_PROGRAM_ID } from './constants';

const enc = getAddressEncoder();
const utf8 = getUtf8Encoder();

async function pda(seeds: (string | Address)[], program: Address = HELIX_PROGRAM_ID): Promise<Address> {
  const [a] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: seeds.map((s, i) => (i === 0 ? utf8.encode(s) : enc.encode(s as Address))),
  });
  return a;
}

export const configAddress = () => pda(['config']);
export const holdingAddress = (mint: Address, owner: Address) => pda(['holding', mint, owner]);
export const poolAddress = (mint: Address) => pda(['pool', mint]);
export const launchAddress = (mint: Address) => pda(['launch', mint]);
export const positionAddress = (pool: Address, owner: Address) => pda(['position', pool, owner]);
/** The PDA HELIX signs every callback of `hookProgram` with. */
export const hookSignerAddress = (hookProgram: Address) => pda(['hook-authority', hookProgram]);
/** The PDA a hook program signs `write_hook_data` with. */
export const hookSelfAddress = (hookProgram: Address) => pda(['hook-authority'], hookProgram);
/** Where a hook publishes the extra accounts its callbacks need, for clients. */
export const extraAccountsAddress = (hookProgram: Address, mint: Address) => pda(['extra-accounts', mint], hookProgram);
/** The upgradeable loader's ProgramData account of a program. */
export async function programDataAddress(program: Address = HELIX_PROGRAM_ID): Promise<Address> {
  const [a] = await getProgramDerivedAddress({ programAddress: LOADER_UPGRADEABLE_ID, seeds: [enc.encode(program)] });
  return a;
}

/** Bridge in: the wrapper of an SPL / Token-2022 mint, and the HELIX mint that wraps it. */
export const wrapperAddress = (splMint: Address) => pda(['wrapper', splMint]);
export const wrappedMintAddress = (splMint: Address) => pda(['wrapped', splMint]);
/** Bridge out: a HELIX mint's mirror, and the Token-2022 mint that mirrors it. */
export const mirrorAddress = (helixMint: Address) => pda(['mirror', helixMint]);
export const mirrorMintAddress = (helixMint: Address) => pda(['mirror-mint', helixMint]);

/** The associated token account of `owner` for `mint` under `tokenProgram`. */
export async function ataAddress(owner: Address, mint: Address, tokenProgram: Address = TOKEN_PROGRAM_ID): Promise<Address> {
  const [a] = await getProgramDerivedAddress({ programAddress: ATA_PROGRAM_ID, seeds: [enc.encode(owner), enc.encode(tokenProgram), enc.encode(mint)] });
  return a;
}

/** A mint's Metaplex metadata account. */
export async function metaplexMetadataAddress(mint: Address): Promise<Address> {
  const [a] = await getProgramDerivedAddress({
    programAddress: METAPLEX_PROGRAM_ID,
    seeds: [utf8.encode('metadata'), enc.encode(METAPLEX_PROGRAM_ID), enc.encode(mint)],
  });
  return a;
}
