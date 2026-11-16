// Glean data layer: every read goes through the official @ammora-protocol/sdk
// (deployment registry, ABIs, V4 launch curve client, RevenueCenterClient,
// DFSClient) plus viem as the SDK's transport. All amounts shown by the UI
// come from live contract reads or eth_call simulations in this file.
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  http,
  toEventSelector,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import {
  AmmoraV4LaunchCurveClient,
  DFSClient,
  RevenueCenterClient,
  almmBinPoolAbi,
  almmFactoryAbi,
  ammConcentratedFactoryV3Abi,
  ammConcentratedPoolV3Abi,
  ammoraAFSFactoryAbi,
  ammoraAFSVaultAbi,
  ammoraLaunchFactoryV4Abi,
  ammoraLaunchPoolV4Abi,
  feeVaultAbi,
  giwaSepoliaAutoRouteDeployment as AUTO,
} from '@ammora-protocol/sdk';

export const RPC_URL = 'https://sepolia-rpc.giwa.io';
export const EXPLORER = 'https://sepolia-explorer.giwa.io';
export const FACTORY = AUTO.contracts.launch.factory as Address;
export const FEE_POLICY = AUTO.contracts.launch.feePolicy as Address;
export const ALMM_FACTORY = AUTO.contracts.liquidityMarketMaker.factory as Address;
export const CONC_FACTORY = AUTO.contracts.launch.concentratedFactory as Address;
export const DFS_FACTORY = AUTO.contracts.feeSharing.factory as Address;
// The previous deployment slot ("vaults") has its own fee-sharing factory
// whose vaults are still live contracts with recipients.
export const DFS_FACTORY_LEGACY = '0x6eb2b96270001fb6a82cec6c2542cda1039c1d28' as Address;
export const WETH = AUTO.contracts.tokens.wrappedNative as Address;
const DEPLOY_START = Number(AUTO.startBlock); // 36,220,000
const LEGACY_DFS_START = 32_500_768;
const LOG_CHUNK = 10_000; // GIWA RPC rejects eth_getLogs ranges above 10,000 blocks
const ZERO = '0x0000000000000000000000000000000000000000';

export const giwaChain = defineChain({
  id: 91342,
  name: 'GIWA Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'GIWA Explorer', url: EXPLORER } },
});

export const publicClient: PublicClient = createPublicClient({
  chain: giwaChain,
  // No batch:true: the GIWA public RPC silently drops calls when a burst of
  // batched eth_calls lands at once (proven during the Slipway build).
  // Plain transport + explicit retries + a narrow queue below is reliable.
  transport: http(RPC_URL, { timeout: 30_000, retryCount: 3, retryDelay: 600 }),
});

// ---------- retry + narrow concurrency queue ----------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseDelayMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i + Math.floor(Math.random() * 150));
    }
  }
  throw lastErr;
}

function makeQueue(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return function queued<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          const next = waiters.shift();
          if (next) next();
        });
      };
      if (active < max) run();
      else waiters.push(run);
    });
  };
}
const queued = makeQueue(3);

/** A single contract read through the queue with retries. Throws after retries. */
export function read<T>(params: Parameters<PublicClient['readContract']>[0]): Promise<T> {
  return queued(() => withRetry(() => publicClient.readContract(params), 3, 350)) as Promise<T>;
}

/** An eth_call simulation through the queue with retries. Throws after retries. */
export function simulate<T>(params: Parameters<PublicClient['simulateContract']>[0]): Promise<{ result: T }> {
  return queued(() => withRetry(() => publicClient.simulateContract(params), 3, 350)) as Promise<{ result: T }>;
}

export function getBlockNumber(): Promise<bigint> {
  return withRetry(() => publicClient.getBlockNumber(), 3, 500);
}

// ---------- local cache helpers ----------
function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: run uncached */
  }
}

type Range = [number, number];
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}
function gaps(ranges: Range[], from: number, to: number): Range[] {
  const out: Range[] = [];
  let cur = from;
  for (const [a, b] of mergeRanges(ranges)) {
    if (b < cur) continue;
    if (a > cur) out.push([cur, Math.min(a - 1, to)]);
    cur = Math.max(cur, b + 1);
    if (cur > to) return out;
  }
  if (cur <= to) out.push([cur, to]);
  return out;
}

// ---------- generic cached event discovery ----------
export interface LaunchRec {
  token: Address;
  curve: Address;
  creator: Address;
  block: number;
}
export interface AlmmPoolRec {
  pool: Address;
  baseToken: Address;
  quoteToken: Address;
  block: number;
}
export interface ConcPoolRec {
  pool: Address;
  creator: Address;
  baseToken: Address;
  quoteToken: Address;
  block: number;
}
export interface DfsVaultRec {
  vault: Address;
  owner: Address;
  token: Address;
  block: number;
}
export interface Discovery {
  launches: LaunchRec[];
  almmPools: AlmmPoolRec[];
  concPools: ConcPoolRec[];
  dfsVaults: DfsVaultRec[];
  complete: { launches: boolean; almm: boolean; conc: boolean; dfs: boolean };
  head: number;
}

interface ScanSource<T> {
  key: string;
  address: Address;
  abi: Abi;
  eventName: string;
  startBlock: number;
  map: (args: Record<string, unknown>, block: number) => T;
  idOf: (rec: T) => string;
}

async function scanSource<T>(src: ScanSource<T>, head: number): Promise<{ records: T[]; complete: boolean }> {
  const lsRecords = `glean.v1.scan.${src.key}.records`;
  const lsRanges = `glean.v1.scan.${src.key}.ranges`;
  const byId = new Map<string, T>();
  for (const r of lsGet<T[]>(lsRecords) ?? []) byId.set(src.idOf(r).toLowerCase(), r);
  let ranges = lsGet<Range[]>(lsRanges) ?? [];
  const eventEntry = src.abi.find((x) => x.type === 'event' && x.name === src.eventName) as
    | { inputs: { type: string }[] }
    | undefined;
  if (!eventEntry) throw new Error(`event ${src.eventName} not in ABI`);
  const topic = toEventSelector(`${src.eventName}(${eventEntry.inputs.map((i) => i.type).join(',')})`);

  const chunks: Range[] = [];
  for (const [a, b] of gaps(ranges, src.startBlock, head)) {
    for (let s = a; s <= b; s += LOG_CHUNK) chunks.push([s, Math.min(s + LOG_CHUNK - 1, b)]);
  }
  chunks.sort((x, y) => y[1] - x[1]); // newest first
  let failed = 0;
  let idx = 0;
  const worker = async () => {
    while (idx < chunks.length) {
      const [from, to] = chunks[idx++];
      try {
        const logs = (await withRetry(
          () =>
            publicClient.request({
              method: 'eth_getLogs',
              params: [
                {
                  address: src.address,
                  topics: [topic],
                  fromBlock: `0x${from.toString(16)}`,
                  toBlock: `0x${to.toString(16)}`,
                },
              ],
            } as never),
          3,
          600,
        )) as { topics: Hex[]; data: Hex; blockNumber: Hex }[];
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({ abi: src.abi as never, data: log.data, topics: log.topics } as never) as unknown as {
              args: Record<string, unknown>;
            };
            const rec = src.map(decoded.args, Number(BigInt(log.blockNumber)));
            byId.set(src.idOf(rec).toLowerCase(), rec);
          } catch {
            /* undecodable log: skip */
          }
        }
        ranges = mergeRanges([...ranges, [from, to]]);
      } catch {
        failed++; // leave the gap unscanned; the source reports incomplete
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const records = [...byId.values()];
  lsSet(lsRecords, records);
  lsSet(lsRanges, ranges);
  return { records, complete: failed === 0 };
}

export async function discover(): Promise<Discovery> {
  const head = Number(await getBlockNumber());
  const [launches, almm, conc, dfsNew, dfsOld] = await Promise.all([
    scanSource<LaunchRec>(
      {
        key: 'launches',
        address: FACTORY,
        abi: ammoraLaunchFactoryV4Abi as unknown as Abi,
        eventName: 'LaunchCreated',
        startBlock: DEPLOY_START,
        map: (a, block) => ({ token: a.token as Address, curve: a.curve as Address, creator: a.creator as Address, block }),
        idOf: (r) => r.curve,
      },
      head,
    ),
    scanSource<AlmmPoolRec>(
      {
        key: 'almm',
        address: ALMM_FACTORY,
        abi: almmFactoryAbi as unknown as Abi,
        eventName: 'PoolCreated',
        startBlock: DEPLOY_START,
        map: (a, block) => ({ pool: a.pool as Address, baseToken: a.baseToken as Address, quoteToken: a.quoteToken as Address, block }),
        idOf: (r) => r.pool,
      },
      head,
    ),
    scanSource<ConcPoolRec>(
      {
        key: 'conc',
        address: CONC_FACTORY,
        abi: ammConcentratedFactoryV3Abi as unknown as Abi,
        eventName: 'PoolCreated',
        startBlock: DEPLOY_START,
        map: (a, block) => ({
          pool: a.pool as Address,
          creator: a.creator as Address,
          baseToken: a.baseToken as Address,
          quoteToken: a.quoteToken as Address,
          block,
        }),
        idOf: (r) => r.pool,
      },
      head,
    ),
    scanSource<DfsVaultRec>(
      {
        key: 'dfsnew',
        address: DFS_FACTORY,
        abi: ammoraAFSFactoryAbi as unknown as Abi,
        eventName: 'AFSVaultCreated',
        startBlock: DEPLOY_START,
        map: (a, block) => ({ vault: a.vault as Address, owner: a.owner as Address, token: a.token as Address, block }),
        idOf: (r) => r.vault,
      },
      head,
    ),
    scanSource<DfsVaultRec>(
      {
        key: 'dfsold',
        address: DFS_FACTORY_LEGACY,
        abi: ammoraAFSFactoryAbi as unknown as Abi,
        eventName: 'AFSVaultCreated',
        startBlock: LEGACY_DFS_START,
        map: (a, block) => ({ vault: a.vault as Address, owner: a.owner as Address, token: a.token as Address, block }),
        idOf: (r) => r.vault,
      },
      head,
    ),
  ]);
  // Canonical pools of migrated launches belong to the concentrated factory
  // too, so the factory scan covers them; no separate source is needed.
  return {
    launches: launches.records,
    almmPools: almm.records,
    concPools: conc.records,
    dfsVaults: [...dfsNew.records, ...dfsOld.records],
    complete: {
      launches: launches.complete,
      almm: almm.complete,
      conc: conc.complete,
      dfs: dfsNew.complete && dfsOld.complete,
    },
    head,
  };
}

// ---------- token metadata (only successful resolutions are cached) ----------
export interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  resolved: boolean;
}
const LS_META = 'glean.v1.meta';
const metaCache = new Map<string, TokenMeta>();
for (const [k, v] of Object.entries(lsGet<Record<string, TokenMeta>>(LS_META) ?? {})) {
  if (v && v.name && v.symbol) metaCache.set(k, { ...v, resolved: true });
}
const metaInflight = new Map<string, Promise<TokenMeta>>();
const metaFailedAt = new Map<string, number>();
const META_FALLBACK: TokenMeta = { name: '', symbol: '', decimals: 18, resolved: false };

export function tokenMeta(token: Address): Promise<TokenMeta> {
  if (token.toLowerCase() === WETH.toLowerCase()) {
    return Promise.resolve({ name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, resolved: true });
  }
  const key = token.toLowerCase();
  const hit = metaCache.get(key);
  if (hit) return Promise.resolve(hit);
  const flying = metaInflight.get(key);
  if (flying) return flying;
  const failedAt = metaFailedAt.get(key);
  if (failedAt && Date.now() - failedAt < 20_000) return Promise.resolve(META_FALLBACK);
  const job = (async (): Promise<TokenMeta> => {
    try {
      const one = async (functionName: 'name' | 'symbol' | 'decimals') =>
        read<unknown>({ address: token, abi: erc20Abi, functionName }).catch(() => null);
      const [name, symbol, decimals] = await Promise.all([one('name'), one('symbol'), one('decimals')]);
      if (typeof name === 'string' && name && typeof symbol === 'string' && symbol) {
        const meta: TokenMeta = { name, symbol, decimals: typeof decimals === 'number' ? decimals : 18, resolved: true };
        metaCache.set(key, meta);
        metaFailedAt.delete(key);
        lsSet(LS_META, Object.fromEntries(metaCache));
        return meta;
      }
      metaFailedAt.set(key, Date.now());
      return META_FALLBACK;
    } finally {
      metaInflight.delete(key);
    }
  })();
  metaInflight.set(key, job);
  return job;
}

// ---------- fee stream sweep ----------
export type StreamId = 'surplus' | 'leftover' | 'partner' | 'almm' | 'arl' | 'dfs';
export const STREAMS: StreamId[] = ['surplus', 'leftover', 'partner', 'almm', 'arl', 'dfs'];

export type ClaimSpec =
  | { kind: 'surplus'; curve: Address }
  | { kind: 'leftover'; curve: Address }
  | { kind: 'partner'; curve: Address }
  | { kind: 'almm'; pool: Address; token: Address }
  | { kind: 'arl'; pool: Address; feeVault: Address; token: Address }
  | { kind: 'dfs'; vault: Address; index: number };

export interface ClaimRow {
  key: string;
  stream: StreamId;
  /** display source: a launch token, a pool pair, or a vault */
  source: { launchToken?: Address; pair?: [Address, Address]; vault?: Address };
  /** fee token; null means native ETH */
  token: Address | null;
  /** null when the amount could not be read */
  amount: bigint | null;
  state: 'claimable' | 'zero' | 'unavailable' | 'notready';
  role?: 'creator' | 'referral';
  shareText?: string;
  claim: ClaimSpec;
}

export interface LookupResult {
  address: Address;
  rows: ClaimRow[];
  /** false when that stream's sweep hit read failures: absence of rows is not proof of zero */
  streamOk: Record<StreamId, boolean>;
  block: number;
}

interface CurveInfo {
  status: number;
  creator: Address;
  baseToken: Address;
  quoteToken: Address;
  partnerRecipient: Address;
}

const poolAbi = ammoraLaunchPoolV4Abi as unknown as Abi;
const factoryAbi = ammoraLaunchFactoryV4Abi as unknown as Abi;

/** Extract a contract error name (e.g. MigrationNotReady) from a viem error chain. */
function revertName(e: unknown): string {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
    const o = cur as { data?: { errorName?: unknown }; errorName?: unknown; cause?: unknown };
    if (typeof o.data?.errorName === 'string') return o.data.errorName;
    if (typeof o.errorName === 'string') return o.errorName;
    cur = o.cause;
  }
  return '';
}
const NOT_READY = /NotReady|NothingTo|NoSurplus|NoLeftover|NotYet/i;

async function curveInfo(curve: Address): Promise<CurveInfo> {
  // SDK client first; it authenticates the curve against the reviewed
  // deployment. Fall back to raw SDK-ABI reads if the client rejects it.
  try {
    const vc = new AmmoraV4LaunchCurveClient(publicClient, curve, { launchFactory: FACTORY, feePolicy: FEE_POLICY });
    const st = await queued(() => withRetry(() => vc.getState(), 2, 400));
    return {
      status: st.status,
      creator: st.creator as Address,
      baseToken: st.baseToken as Address,
      quoteToken: st.quoteToken as Address,
      partnerRecipient: st.partnerRecipient as Address,
    };
  } catch {
    const [status, creator, baseToken, quoteToken] = await Promise.all([
      read<number>({ address: curve, abi: poolAbi, functionName: 'status' }),
      read<Address>({ address: curve, abi: poolAbi, functionName: 'creator' }),
      read<Address>({ address: curve, abi: poolAbi, functionName: 'baseToken' }),
      read<Address>({ address: curve, abi: poolAbi, functionName: 'quoteToken' }),
    ]);
    return { status: Number(status), creator, baseToken, quoteToken, partnerRecipient: ZERO as Address };
  }
}

export async function lookup(
  target: Address,
  disc: Discovery,
  onProgress: (done: number, total: number) => void,
): Promise<LookupResult> {
  const rows: ClaimRow[] = [];
  const streamOk: Record<StreamId, boolean> = {
    surplus: disc.complete.launches,
    leftover: disc.complete.launches,
    partner: disc.complete.launches,
    almm: disc.complete.almm,
    arl: disc.complete.conc,
    dfs: disc.complete.dfs,
  };
  const mine = disc.launches.filter((l) => l.creator.toLowerCase() === target.toLowerCase());
  // Work items: my curves (state + maybe simulation), every curve (partner
  // check), every ALMM pool, every concentrated pool, every DFS vault.
  const total =
    mine.length + disc.launches.length + disc.almmPools.length + disc.concPools.length + disc.dfsVaults.length;
  let done = 0;
  const tick = () => {
    done++;
    onProgress(done, total);
  };

  // --- creator surplus + leftover (only the target's own launches) ---
  await Promise.all(
    mine.map(async (l) => {
      try {
        const info = await curveInfo(l.curve);
        // The launch event names the original creator, but creator rights can
        // be transferred on the curve. Only the current creator can claim.
        if (info.creator.toLowerCase() !== target.toLowerCase()) return;
        if (info.status === 2) {
          try {
            const { result } = await simulate<bigint>({
              address: l.curve,
              abi: poolAbi,
              functionName: 'claimSurplus',
              account: target,
            });
            rows.push({
              key: `surplus-${l.curve}`,
              stream: 'surplus',
              source: { launchToken: l.token },
              token: info.quoteToken,
              amount: result,
              state: result > 0n ? 'claimable' : 'zero',
              claim: { kind: 'surplus', curve: l.curve },
            });
          } catch (e) {
            // A revert naming a not-ready condition is a successful read with
            // a locked answer, not a failed read.
            const notReady = NOT_READY.test(revertName(e));
            if (!notReady) streamOk.surplus = false;
            rows.push({
              key: `surplus-${l.curve}`,
              stream: 'surplus',
              source: { launchToken: l.token },
              token: info.quoteToken,
              amount: null,
              state: notReady ? 'notready' : 'unavailable',
              claim: { kind: 'surplus', curve: l.curve },
            });
          }
        } else if (info.status === 3) {
          try {
            const { result } = await simulate<bigint>({
              address: l.curve,
              abi: poolAbi,
              functionName: 'withdrawLeftover',
              account: target,
            });
            rows.push({
              key: `leftover-${l.curve}`,
              stream: 'leftover',
              source: { launchToken: l.token },
              token: info.quoteToken,
              amount: result,
              state: result > 0n ? 'claimable' : 'zero',
              claim: { kind: 'leftover', curve: l.curve },
            });
          } catch (e) {
            const notReady = NOT_READY.test(revertName(e));
            if (!notReady) streamOk.leftover = false;
            rows.push({
              key: `leftover-${l.curve}`,
              stream: 'leftover',
              source: { launchToken: l.token },
              token: info.quoteToken,
              amount: null,
              state: notReady ? 'notready' : 'unavailable',
              claim: { kind: 'leftover', curve: l.curve },
            });
          }
        }
      } catch {
        streamOk.surplus = false;
        streamOk.leftover = false;
      } finally {
        tick();
      }
    }),
  );

  // --- launch partner pool creation fees (factory record per launch) ---
  await Promise.all(
    disc.launches.map(async (l) => {
      try {
        const partner = await read<Address>({
          address: FACTORY,
          abi: factoryAbi,
          functionName: 'poolCreationFeePartner',
          args: [l.curve],
        });
        if (partner && partner.toLowerCase() === target.toLowerCase()) {
          try {
            const { result } = await simulate<bigint>({
              address: FACTORY,
              abi: factoryAbi,
              functionName: 'claimPartnerPoolCreationFee',
              args: [l.curve],
              account: target,
            });
            rows.push({
              key: `partner-${l.curve}`,
              stream: 'partner',
              source: { launchToken: l.token },
              token: null, // paid in native ETH
              amount: result,
              state: result > 0n ? 'claimable' : 'zero',
              claim: { kind: 'partner', curve: l.curve },
            });
          } catch {
            streamOk.partner = false;
            rows.push({
              key: `partner-${l.curve}`,
              stream: 'partner',
              source: { launchToken: l.token },
              token: null,
              amount: null,
              state: 'unavailable',
              claim: { kind: 'partner', curve: l.curve },
            });
          }
        }
      } catch {
        streamOk.partner = false;
      } finally {
        tick();
      }
    }),
  );

  // --- ALMM referral fees (owed views on each pool) ---
  await Promise.all(
    disc.almmPools.map(async (p) => {
      try {
        const [baseOwed, quoteOwed] = await Promise.all([
          read<bigint>({ address: p.pool, abi: almmBinPoolAbi as unknown as Abi, functionName: 'referralFeeBaseOwed', args: [target] }),
          read<bigint>({ address: p.pool, abi: almmBinPoolAbi as unknown as Abi, functionName: 'referralFeeQuoteOwed', args: [target] }),
        ]);
        for (const [token, amount] of [
          [p.baseToken, baseOwed],
          [p.quoteToken, quoteOwed],
        ] as [Address, bigint][]) {
          rows.push({
            key: `almm-${p.pool}-${token}`,
            stream: 'almm',
            source: { pair: [p.baseToken, p.quoteToken] },
            token,
            amount,
            state: amount > 0n ? 'claimable' : 'zero',
            claim: { kind: 'almm', pool: p.pool, token },
          });
        }
      } catch {
        streamOk.almm = false;
      } finally {
        tick();
      }
    }),
  );

  // --- ARL pool revenue (fee vault claimable per token) ---
  // One fee vault serves many pools and its claimable(token, beneficiary)
  // balance is a single pot per token, NOT per pool: rows are therefore
  // built per (vault, token), never per pool, or totals would multiply.
  {
    const vaultOf = new Map<string, Address>(); // pool -> feeVault
    await Promise.all(
      disc.concPools.map(async (p) => {
        try {
          const feeVault = await read<Address>({
            address: p.pool,
            abi: ammConcentratedPoolV3Abi as unknown as Abi,
            functionName: 'feeVault',
          });
          if (feeVault && feeVault !== ZERO) vaultOf.set(p.pool.toLowerCase(), feeVault);
        } catch {
          streamOk.arl = false;
        } finally {
          tick();
        }
      }),
    );
    const byVault = new Map<string, { feeVault: Address; pools: ConcPoolRec[]; tokens: Map<string, Address> }>();
    for (const p of disc.concPools) {
      const fv = vaultOf.get(p.pool.toLowerCase());
      if (!fv) continue;
      const key = fv.toLowerCase();
      const entry = byVault.get(key) ?? { feeVault: fv, pools: [], tokens: new Map<string, Address>() };
      entry.pools.push(p);
      entry.tokens.set(p.baseToken.toLowerCase(), p.baseToken);
      entry.tokens.set(p.quoteToken.toLowerCase(), p.quoteToken);
      byVault.set(key, entry);
    }
    await Promise.all(
      [...byVault.values()].map(async (entry) => {
        const role = entry.pools.some((p) => p.creator.toLowerCase() === target.toLowerCase()) ? 'creator' : 'referral';
        for (const token of entry.tokens.values()) {
          try {
            const amount = await read<bigint>({
              address: entry.feeVault,
              abi: feeVaultAbi as unknown as Abi,
              functionName: 'claimable',
              args: [token, target],
            });
            rows.push({
              key: `arl-${entry.feeVault}-${token}`,
              stream: 'arl',
              source: { vault: entry.feeVault },
              token,
              amount,
              state: amount > 0n ? 'claimable' : 'zero',
              role,
              claim: { kind: 'arl', pool: entry.pools[0].pool, feeVault: entry.feeVault, token },
            });
          } catch {
            streamOk.arl = false;
          }
        }
      }),
    );
  }

  // --- DFS fee-sharing vaults (recipient shares) ---
  await Promise.all(
    disc.dfsVaults.map(async (v) => {
      try {
        const dc = new DFSClient(publicClient, v.vault);
        const st = await queued(() => withRetry(() => dc.getState(), 2, 400));
        for (const r of st.recipients) {
          if (r.recipient.toLowerCase() !== target.toLowerCase()) continue;
          const totalShare = st.totalShare > 0n ? st.totalShare : 1n;
          const pct = Number((r.share * 10000n) / totalShare) / 100;
          rows.push({
            key: `dfs-${v.vault}-${r.index}`,
            stream: 'dfs',
            source: { vault: v.vault },
            token: st.token as Address,
            amount: r.claimable,
            state: r.claimable > 0n ? 'claimable' : 'zero',
            shareText: `${pct}%`,
            claim: { kind: 'dfs', vault: v.vault, index: r.index },
          });
        }
      } catch {
        streamOk.dfs = false;
      } finally {
        tick();
      }
    }),
  );

  onProgress(total, total);
  return { address: target, rows, streamOk, block: disc.head };
}

// ---------- wallet (visitor's own, testnet only) ----------
declare global {
  interface Window {
    ethereum?: unknown;
  }
}

export interface Wallet {
  address: Address;
  client: WalletClient;
}

export async function connectWallet(): Promise<Wallet> {
  if (!window.ethereum) throw new Error('NO_WALLET');
  const client = createWalletClient({ chain: giwaChain, transport: custom(window.ethereum as never) });
  const [address] = await client.requestAddresses();
  try {
    await client.switchChain({ id: giwaChain.id });
  } catch {
    await (window.ethereum as { request: (a: unknown) => Promise<unknown> }).request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: `0x${giwaChain.id.toString(16)}`,
          chainName: giwaChain.name,
          nativeCurrency: giwaChain.nativeCurrency,
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER],
        },
      ],
    });
    await client.switchChain({ id: giwaChain.id });
  }
  return { address, client };
}

interface TxLike {
  to: Address;
  data: Hex;
  value?: bigint;
}

function directTx(spec: ClaimSpec, owner: Address): TxLike {
  switch (spec.kind) {
    case 'surplus':
      return { to: spec.curve, data: encodeFunctionData({ abi: poolAbi, functionName: 'claimSurplus' } as never) };
    case 'leftover':
      return { to: spec.curve, data: encodeFunctionData({ abi: poolAbi, functionName: 'withdrawLeftover' } as never) };
    case 'partner':
      return {
        to: FACTORY,
        data: encodeFunctionData({ abi: factoryAbi, functionName: 'claimPartnerPoolCreationFee', args: [spec.curve] } as never),
      };
    case 'almm':
      return {
        to: spec.pool,
        data: encodeFunctionData({
          abi: almmBinPoolAbi as unknown as Abi,
          functionName: 'claimReferralFee',
          args: [spec.token, owner],
        } as never),
      };
    case 'arl':
      return {
        to: spec.feeVault,
        data: encodeFunctionData({
          abi: feeVaultAbi as unknown as Abi,
          functionName: 'claim',
          args: [spec.token, owner],
        } as never),
      };
    case 'dfs':
      return {
        to: spec.vault,
        data: encodeFunctionData({
          abi: ammoraAFSVaultAbi as unknown as Abi,
          functionName: 'claim',
          args: [spec.index],
        } as never),
      };
  }
}

/** Plan a claim with the SDK planners first; fall back to the SDK-ABI call. */
async function planClaim(spec: ClaimSpec, owner: Address): Promise<TxLike> {
  try {
    switch (spec.kind) {
      case 'surplus': {
        const vc = new AmmoraV4LaunchCurveClient(publicClient, spec.curve, { launchFactory: FACTORY, feePolicy: FEE_POLICY });
        const plan = await vc.planClaimSurplus(owner);
        return plan.transaction as TxLike;
      }
      case 'leftover': {
        const vc = new AmmoraV4LaunchCurveClient(publicClient, spec.curve, { launchFactory: FACTORY, feePolicy: FEE_POLICY });
        const plan = await vc.planWithdrawLeftover(owner);
        return plan.transaction as TxLike;
      }
      case 'partner': {
        const rc = new RevenueCenterClient(publicClient);
        const plan = await rc.planClaimALCPartnerPoolCreationFee({ curve: spec.curve, beneficiary: owner });
        return plan.transaction as TxLike;
      }
      case 'almm': {
        const rc = new RevenueCenterClient(publicClient);
        const plan = await rc.planClaimALMMReferral({ pool: spec.pool, token: spec.token, beneficiary: owner });
        return plan.transaction as TxLike;
      }
      case 'arl': {
        const rc = new RevenueCenterClient(publicClient);
        const plan = await rc.planClaimARLRevenue({ pool: spec.pool, token: spec.token, beneficiary: owner });
        return plan.transaction as TxLike;
      }
      case 'dfs': {
        const dc = new DFSClient(publicClient, spec.vault);
        const tx = dc.planClaim(spec.index, owner);
        return tx as TxLike;
      }
    }
  } catch {
    return directTx(spec, owner);
  }
}

export async function executeClaim(wallet: Wallet, row: ClaimRow): Promise<Hex> {
  const tx = await planClaim(row.claim, wallet.address);
  const hash = await wallet.client.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    account: wallet.address,
    chain: giwaChain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatAmount(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  let fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  if (fracStr.length > 8) {
    // Keep up to 6 significant digits so dust amounts (a few wei) never
    // render as a misleading "0.000000".
    const firstSig = fracStr.search(/[1-9]/);
    fracStr = fracStr.slice(0, Math.max(8, firstSig + 6)).replace(/0+$/, '');
  }
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''}`;
}
