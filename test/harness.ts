import path from 'node:path';
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { Clock, FailedTransactionMetadata, LiteSVM, type TransactionMetadata } from 'litesvm';
import {
  DEFAULT_CONFIG,
  EXAMPLE_HOOK_PROGRAM_ID,
  HELIX_PROGRAM_ID,
  LOADER_UPGRADEABLE_ID,
  configAddress,
  decodeConfig,
  decodeHolding,
  decodeLaunch,
  decodeMint,
  decodePool,
  decodePosition,
  explainFailure,
  holdingAddress,
  ix,
  launchAddress,
  parseEvents,
  poolAddress,
  programDataAddress,
  type ConfigParams,
  type HelixEvent,
  type LaunchRules,
} from '../src';
import { setComputeUnitLimit } from '../src/compute';

// The deployed program's binaries (fixtures/README.md says how to check them against mainnet).
const fixtures = path.resolve(import.meta.dirname, '../fixtures');
export const SOL = 1_000_000_000n;

export class Env {
  svm = new LiteSVM();
  now = 1_800_000_000n;
  admin!: KeyPairSigner;
  collector!: KeyPairSigner;
  config!: Address;

  static async create(params?: Partial<ConfigParams>) {
    const e = new Env();
    e.svm.addProgramFromFile(HELIX_PROGRAM_ID, path.join(fixtures, 'helix.so'));
    e.svm.addProgramFromFile(EXAMPLE_HOOK_PROGRAM_ID, path.join(fixtures, 'example_hook.so'));
    e.setTime(e.now);
    e.admin = await e.wallet(100n * SOL);
    e.collector = await e.wallet(1n * SOL);
    e.config = await configAddress();
    await e.writeProgramData(e.admin.address);
    const r = await e.send(
      [
        ix.initConfig(
          { authority: e.admin, config: e.config, programData: await programDataAddress() },
          { ...DEFAULT_CONFIG, feeCollector: e.collector.address, ...params },
        ),
      ],
      e.admin,
    );
    if (!r.ok) throw new Error(`init_config failed: ${r.error}\n${r.logs.join('\n')}`);
    return e;
  }

  /** A ProgramData account naming `authority` as HELIX's upgrade authority, as the loader keeps it. */
  async writeProgramData(authority: Address) {
    const data = new Uint8Array(45);
    data[0] = 3;
    data[12] = 1;
    data.set(getAddressEncoder().encode(authority), 13);
    this.svm.setAccount({
      address: await programDataAddress(),
      data,
      executable: false,
      lamports: lamports(10_000_000n),
      programAddress: LOADER_UPGRADEABLE_ID,
      space: 45n,
    });
  }

  setTime(t: bigint) {
    this.now = t;
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, t));
  }

  advance(secs: number) {
    this.setTime(this.now + BigInt(secs));
  }

  async wallet(sol = 10n * SOL) {
    const k = await generateKeyPairSigner();
    this.svm.airdrop(k.address, lamports(sol));
    return k;
  }

  balance(a: Address) {
    return this.svm.getBalance(a) ?? 0n;
  }

  data(a: Address): Uint8Array | null {
    const acc = this.svm.getAccount(a);
    return acc.exists ? new Uint8Array(acc.data) : null;
  }

  configState() {
    return decodeConfig(this.data(this.config)!);
  }
  mint(a: Address) {
    return decodeMint(this.data(a)!);
  }
  holding(a: Address) {
    return decodeHolding(this.data(a)!);
  }
  pool(a: Address) {
    return decodePool(this.data(a)!);
  }
  launch(a: Address) {
    return decodeLaunch(this.data(a)!);
  }
  position(a: Address) {
    return decodePosition(this.data(a)!);
  }
  async tokens(mint: Address, owner: Address) {
    const d = this.data(await holdingAddress(mint, owner));
    return d ? decodeHolding(d).amount : 0n;
  }

  async send(ixs: Instruction[], payer: KeyPairSigner, cu = 400_000) {
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
      (m) => appendTransactionMessageInstructions([setComputeUnitLimit(cu), ...ixs], m),
    );
    const tx = await signTransactionMessageWithSigners(msg);
    const res = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) {
      const logs = res.meta().logs();
      return { ok: false as const, error: explainFailure(logs) ?? res.toString(), logs, events: [] as HelixEvent[], cu: 0n };
    }
    const meta = res as TransactionMetadata;
    const logs = meta.logs();
    return { ok: true as const, error: null, logs, events: parseEvents(logs), cu: meta.computeUnitsConsumed() };
  }

  /** Sends and throws with the program's error in words if it fails. */
  async ok(ixs: Instruction[], payer: KeyPairSigner, cu?: number) {
    const r = await this.send(ixs, payer, cu);
    if (!r.ok) throw new Error(`${r.error}\n${r.logs.slice(-12).join('\n')}`);
    return r;
  }

  /** Sends and returns the error name; throws if it succeeds. */
  async fails(ixs: Instruction[], payer: KeyPairSigner) {
    const r = await this.send(ixs, payer);
    if (r.ok) throw new Error('expected the transaction to fail');
    return r.error;
  }

  async launch_(
    creator: KeyPairSigner,
    rules: LaunchRules,
    opts: { customHook?: Address; customHookFlags?: number; hook?: Parameters<typeof ix.createLaunch>[0]['hook'] } = {},
  ) {
    const mint = await generateKeyPairSigner();
    const pool = await poolAddress(mint.address);
    const launch = await launchAddress(mint.address);
    const poolHolding = await holdingAddress(mint.address, pool);
    const r = await this.ok(
      [
        ix.createLaunch(
          {
            creator,
            config: this.config,
            mint,
            pool,
            poolHolding,
            launch,
            feeCollector: this.collector.address,
            hook: opts.hook,
          },
          { name: 'Helix Test', symbol: 'HLXT', uri: 'https://helix.example/t.json', rules, customHook: opts.customHook, customHookFlags: opts.customHookFlags },
        ),
      ],
      creator,
    );
    return { mint: mint.address, pool, launch, poolHolding, events: r.events, cu: r.cu };
  }

  /** Buys on a launch pool with `sol` lamports. */
  async buy(
    trader: KeyPairSigner,
    l: { mint: Address; pool: Address; launch: Address; poolHolding: Address },
    sol: bigint,
    opts: { minOut?: bigint; hook?: Parameters<typeof ix.swap>[0]['hook'] } = {},
  ) {
    const traderHolding = await holdingAddress(l.mint, trader.address);
    return this.send(
      [
        ix.createHolding({ payer: trader, holding: traderHolding, mint: l.mint, owner: trader.address }),
        ix.swap(
          { trader, config: this.config, ...l, traderHolding, hook: opts.hook },
          { side: 'buy', amountIn: sol, minOut: opts.minOut ?? 0n },
        ),
      ],
      trader,
    );
  }

  async sell(
    trader: KeyPairSigner,
    l: { mint: Address; pool: Address; launch: Address; poolHolding: Address },
    tokens: bigint,
    opts: { minOut?: bigint; hook?: Parameters<typeof ix.swap>[0]['hook'] } = {},
  ) {
    const traderHolding = await holdingAddress(l.mint, trader.address);
    return this.send(
      [
        ix.swap(
          { trader, config: this.config, ...l, traderHolding, hook: opts.hook },
          { side: 'sell', amountIn: tokens, minOut: opts.minOut ?? 0n },
        ),
      ],
      trader,
    );
  }
}
