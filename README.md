# @helixfi/sdk

TypeScript SDK for **HELIX** on Solana: a token standard whose hooks answer instead of only approving, a DEX that runs them on every swap, a launchpad built on both, and a bridge to SPL tokens. Everything lives in one on-chain program:

```
HLX49qz3CSKQrHrdzrrWygZBaKHWWSG8JwUMFHcZ47Fr
```

It is the same address on every cluster.

The SDK gives you the program's PDAs, account decoders, instruction builders, quotes exact to the lamport, event parsing and error messages. It is built on [`@solana/kit`](https://github.com/anza-xyz/kit), runs in Node and in the browser, and has no other runtime dependencies.

> **Status:** the program has not been audited yet. Check which clusters it is live on before you point real funds at it.

## Install

```sh
pnpm add @helixfi/sdk @solana/kit
# or: npm install @helixfi/sdk @solana/kit
```

`@solana/kit` (v8.4 or later) is a peer dependency. It ships both ESM and CommonJS builds with types, and needs Node 20.18 or later.

## Quick start: quote and buy a launch token

```ts
import { address, createSolanaRpc, getBase64Encoder, type TransactionSigner } from '@solana/kit';
import { configAddress, decodeLaunch, decodePool, holdingAddress, ix, launchAddress, poolAddress, quoteBuy } from '@helixfi/sdk';

const rpc = createSolanaRpc('https://api.devnet.solana.com');
const b64 = getBase64Encoder();

async function buyInstructions(trader: TransactionSigner, mint: ReturnType<typeof address>, lamports: bigint) {
  const pool = await poolAddress(mint);
  const launch = await launchAddress(mint);
  const { value } = await rpc.getMultipleAccounts([pool, launch], { encoding: 'base64' }).send();
  if (!value[0]) throw new Error('No HELIX pool for this mint');
  const poolState = decodePool(new Uint8Array(b64.encode(value[0].data[0])));
  const launchState = value[1] ? decodeLaunch(new Uint8Array(b64.encode(value[1].data[0]))) : null;

  // Every fee is in the quote: protocol, sniper, creator and holders.
  const quote = quoteBuy(poolState, launchState, lamports, BigInt(Math.floor(Date.now() / 1000)), trader.address);
  const minOut = (quote.tokensToTrader * 98n) / 100n; // 2% slippage

  const traderHolding = await holdingAddress(mint, trader.address);
  return [
    ix.createHolding({ payer: trader, holding: traderHolding, mint, owner: trader.address }),
    ix.swap(
      { trader, config: await configAddress(), mint, pool, poolHolding: await holdingAddress(mint, pool), traderHolding, launch },
      { side: 'buy', amountIn: lamports, minOut },
    ),
  ];
}
```

Send the instructions the way you send any `@solana/kit` transaction. `explainFailure(logs)` turns a failed simulation's logs into a readable reason.

Tokens with an external hook need that hook's accounts appended to the swap. See `swapHookAccounts` and `decodeExtraAccounts`.

## What is in it

| Module | Exports |
| --- | --- |
| constants | `HELIX_PROGRAM_ID`, instruction tags (`IX`), account kinds and sizes, rule flags, hook flags and discriminators, `DEFAULT_CONFIG`, token, Token-2022, ATA and Metaplex program IDs |
| pda | `configAddress`, `holdingAddress`, `poolAddress`, `launchAddress`, `positionAddress`, `hookSignerAddress`, `extraAccountsAddress`, `wrapperAddress`, `wrappedMintAddress`, `mirrorAddress`, `mirrorMintAddress`, `ataAddress`, `metaplexMetadataAddress`, … |
| layouts | `decodeConfig`, `decodeMint`, `decodeHolding`, `decodePool`, `decodeLaunch`, `decodePosition`, `decodeWrapper`, `decodeMirror`, `decodeTokenAccount`, `OFFSETS` (for `getProgramAccounts` filters) |
| `ix` | One builder per instruction: tokens (`createMint`, `transfer`, `burn`, …), the DEX (`swap`, `createPool`, `addLiquidity`, `removeLiquidity`), launches (`createLaunch`, `claimCreatorFees`, `claimRewards`, `shareWithHolders`), the bridge (`registerWrapper`, `wrap`, `unwrap`, `createMirror`, `bridgeOut`, `bridgeBack`) and admin |
| math | `quoteBuy`, `quoteSell`, `curveBuy`, `curveSell`, `ammOut`, `spotPrice`, `marketCapLamports`, `curveProgress`, `sideFeeBps`, `sniperBps`, `claimableRewards` |
| events | `parseEvents(logs)`, `decodeEvent` |
| errors | `errorName(code)`, `explainFailure(logs)` |
| hooks | `hookKind`, `hookAccounts`, `swapHookAccounts`, `decodeExtraAccounts` |
| presets | `PRESETS`: ready-made launch rule sets |
| compute | `setComputeUnitLimit`, `setComputeUnitPrice` |

## License

MIT
