// Combined probe: discovery (cached to discovery.json) + stream read checks.
import { createPublicClient, http, defineChain, decodeEventLog, toEventSelector } from 'viem';
import * as sdk from '@ammora-protocol/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const RPC = 'https://sepolia-rpc.giwa.io';
const chain = defineChain({ id: 91342, name: 'GIWA Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const client = createPublicClient({ chain, transport: http(RPC, { timeout: 30000, retryCount: 3, retryDelay: 600 }) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, attempts = 4, base = 400) { let last; for (let i = 0; i < attempts; i++) { try { return await fn(); } catch (e) { last = e; if (i < attempts - 1) await sleep(base * 2 ** i + Math.random() * 150); } } throw last; }
let active = 0; const waiters = [];
function q(fn) { return new Promise((res, rej) => { const run = () => { active++; fn().then(res, rej).finally(() => { active--; const n = waiters.shift(); if (n) n(); }); }; if (active < 3) run(); else waiters.push(run); }); }
const read = (params) => q(() => withRetry(() => client.readContract(params), 3, 350));
const sim = (params) => q(() => withRetry(() => client.simulateContract(params), 3, 350));

async function scanLogs(address, abi, eventName, from, to) {
  const topic = toEventSelector(abi.find(x => x.type === 'event' && x.name === eventName));
  const out = []; const chunks = [];
  for (let s = from; s <= to; s += 10000) chunks.push([s, Math.min(s + 9999, to)]);
  let idx = 0;
  async function worker() { while (idx < chunks.length) { const [a, b] = chunks[idx++]; try { const logs = await withRetry(() => client.request({ method: 'eth_getLogs', params: [{ address, topics: [topic], fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }] }), 3, 600); for (const log of logs) { try { const d = decodeEventLog({ abi, data: log.data, topics: log.topics }); out.push({ args: d.args, block: Number(BigInt(log.blockNumber)) }); } catch {} } } catch (e) { console.log('chunk fail', address, a, String(e).slice(0, 80)); } } }
  await Promise.all([worker(), worker(), worker()]);
  return out.sort((x, y) => x.block - y.block);
}

const FACTORY = '0x35353a2Dab7426EcCAe6f5FB267702a542ab68fA';
const FEE_POLICY = '0x17B44C14F640fD429740FA3220f47a567c62725C';
const ALMM_FACTORY = '0x63c9f1cab865d708a49df5304b59e91474860bde';
const CONC_FACTORY = '0x9eBD78f3839996014238728b4c9C2f2A4e6759Cb';
const DFS_NEW = '0xb6131d1f86321c3de61f0e92fe136fa82e078927';
const DFS_OLD = '0x6eb2b96270001fb6a82cec6c2542cda1039c1d28';
const START = 36220000;
const head = Number(await withRetry(() => client.getBlockNumber(), 3, 500));
console.log('head block:', head);

let disc;
if (existsSync('discovery.json')) { disc = JSON.parse(readFileSync('discovery.json', 'utf8')); console.log('discovery loaded from cache'); }
else {
  const launches = await scanLogs(FACTORY, sdk.ammoraLaunchFactoryV4Abi, 'LaunchCreated', START, head);
  console.log('launches:', launches.length);
  const almmPools = await scanLogs(ALMM_FACTORY, sdk.almmFactoryAbi, 'PoolCreated', START, head);
  console.log('almm pools:', almmPools.length);
  const concPools = await scanLogs(CONC_FACTORY, sdk.ammConcentratedFactoryV3Abi, 'PoolCreated', START, head);
  console.log('conc pools:', concPools.length);
  const dfsNew = await scanLogs(DFS_NEW, sdk.ammoraAFSFactoryAbi, 'AFSVaultCreated', START, head);
  const dfsOld = await scanLogs(DFS_OLD, sdk.ammoraAFSFactoryAbi, 'AFSVaultCreated', 32500768, head);
  console.log('dfs vaults:', dfsNew.length, '+', dfsOld.length);
  disc = { head, launches: launches.map(l => ({ token: l.args.token, curve: l.args.curve, creator: l.args.creator, block: l.block })), almmPools: almmPools.map(p => p.args), concPools: concPools.map(p => ({ pool: p.args.pool, creator: p.args.creator, baseToken: p.args.baseToken, quoteToken: p.args.quoteToken, block: p.block })), dfsNew: dfsNew.map(v => v.args), dfsOld: dfsOld.map(v => v.args) };
  writeFileSync('discovery.json', JSON.stringify(disc, null, 1));
  console.log('discovery saved');
}

const A1 = '0x13cd27a6e337097db858c9c4fa472fbad2f2c637';
const A2 = '0xd57ab6c1f5618e03074c78f11f6ee2c726496bf1';
const poolAbi = sdk.ammoraLaunchPoolV4Abi, facAbi = sdk.ammoraLaunchFactoryV4Abi;

// curve states for A1+A2
const targets = disc.launches.filter(l => [A1, A2].includes(l.creator.toLowerCase()));
console.log('target launches (A1+A2):', targets.length);
const states = new Map();
await Promise.all(targets.map(async (l) => {
  try {
    const vc = new sdk.AmmoraV4LaunchCurveClient(client, l.curve, { launchFactory: FACTORY, feePolicy: FEE_POLICY });
    const st = await q(() => withRetry(() => vc.getState(), 2, 400));
    states.set(l.curve.toLowerCase(), { via: 'sdk', status: st.status, creator: st.creator, partner: st.partnerRecipient, quote: st.quoteToken, base: st.baseToken, canonicalPool: st.canonicalPool });
  } catch (e) {
    try {
      const [status, creator, quote, base, canon] = await Promise.all([
        read({ address: l.curve, abi: poolAbi, functionName: 'status' }),
        read({ address: l.curve, abi: poolAbi, functionName: 'creator' }),
        read({ address: l.curve, abi: poolAbi, functionName: 'quoteToken' }),
        read({ address: l.curve, abi: poolAbi, functionName: 'baseToken' }),
        read({ address: l.curve, abi: poolAbi, functionName: 'canonicalPool' }),
      ]);
      states.set(l.curve.toLowerCase(), { via: 'raw', status: Number(status), creator, quote, base, canonicalPool: canon });
    } catch (e2) { states.set(l.curve.toLowerCase(), { via: 'FAIL', err: String(e2).slice(0, 100) }); }
  }
}));
console.log('curve via:', [...states.values()].reduce((m, s) => (m[s.via] = (m[s.via] ?? 0) + 1, m), {}), 'status dist:', [...states.values()].reduce((m, s) => (m[s.status] = (m[s.status] ?? 0) + 1, m), {}));

for (const l of targets) {
  const s = states.get(l.curve.toLowerCase());
  if (!s || s.via === 'FAIL') continue;
  if (s.status === 2) {
    try { const r = await sim({ address: l.curve, abi: poolAbi, functionName: 'claimSurplus', account: l.creator }); console.log('SURPLUS', l.curve, '=>', r.result.toString(), 'quote', s.quote); }
    catch (e) { console.log('SURPLUS', l.curve, 'SIM FAIL', String(e.shortMessage ?? e).slice(0, 120)); }
  }
  if (s.status === 3) {
    try { const r = await sim({ address: l.curve, abi: poolAbi, functionName: 'withdrawLeftover', account: l.creator }); console.log('LEFTOVER', l.curve, '=>', r.result.toString(), 'quote', s.quote); }
    catch (e) { console.log('LEFTOVER', l.curve, 'SIM FAIL', String(e.shortMessage ?? e).slice(0, 120)); }
  }
}

// partner fees across all launches
const partners = new Map();
await Promise.all(disc.launches.map(async (l) => {
  try { const p = await read({ address: FACTORY, abi: facAbi, functionName: 'poolCreationFeePartner', args: [l.curve] }); if (p && p !== '0x0000000000000000000000000000000000000000') partners.set(l.curve, p); } catch {}
}));
console.log('launches with partner:', partners.size);
for (const [curve, partner] of partners) {
  try {
    const gross = await read({ address: FACTORY, abi: facAbi, functionName: 'poolCreationFee', args: [curve] });
    const r = await sim({ address: FACTORY, abi: facAbi, functionName: 'claimPartnerPoolCreationFee', args: [curve], account: partner });
    console.log('PARTNER', curve, 'partner', partner, 'gross', gross.toString(), 'net', r.result.toString());
  } catch (e) { console.log('PARTNER', curve, 'partner', partner, 'FAIL', String(e.shortMessage ?? e).slice(0, 120)); }
}

// DFS vaults
const dfsRecipients = new Set();
for (const v of [...disc.dfsNew.map(x => x.vault), ...disc.dfsOld.map(x => x.vault)]) {
  try {
    const dc = new sdk.DFSClient(client, v);
    const st = await q(() => withRetry(() => dc.getState(), 2, 400));
    console.log('DFS', v, 'token', st.token, 'funded', st.totalFunded.toString(), 'claimed', st.totalClaimed.toString(), 'recipients:', st.recipients.map(r => `${r.recipient}#${r.index} claimable=${r.claimable}`).join(' | '));
    for (const r of st.recipients) dfsRecipients.add(r.recipient.toLowerCase());
  } catch (e) { console.log('DFS', v, 'FAIL', String(e).slice(0, 150)); }
}

// ALMM referral
const pool = disc.almmPools[0];
if (pool) {
  for (const a of [A1, A2, ...dfsRecipients]) {
    try {
      const [b, qq] = await Promise.all([
        read({ address: pool.pool, abi: sdk.almmBinPoolAbi, functionName: 'referralFeeBaseOwed', args: [a] }),
        read({ address: pool.pool, abi: sdk.almmBinPoolAbi, functionName: 'referralFeeQuoteOwed', args: [a] }),
      ]);
      console.log('ALMM', a, 'baseOwed', b.toString(), 'quoteOwed', qq.toString());
    } catch (e) { console.log('ALMM', a, 'FAIL', String(e).slice(0, 120)); }
  }
  try {
    const rc = new sdk.RevenueCenterClient(client);
    const plan = await q(() => withRetry(() => rc.planClaimALMMReferral({ pool: pool.pool, token: pool.baseToken, beneficiary: A1 }), 2, 400));
    console.log('RevenueCenter ALMM plan OK claimable', plan.claimable.toString(), 'txTo', plan.transaction.to);
  } catch (e) { console.log('RevenueCenter ALMM plan FAIL:', String(e).slice(0, 200)); }
}

// ARL concentrated pools
console.log('conc pools total:', disc.concPools.length);
for (const p of disc.concPools.slice(0, 24)) {
  try {
    const fv = await read({ address: p.pool, abi: sdk.ammConcentratedPoolV3Abi, functionName: 'feeVault' });
    if (!fv || fv === '0x0000000000000000000000000000000000000000') { console.log('ARL', p.pool, 'no feeVault'); continue; }
    for (const a of [A1, A2]) {
      const [cb, cq] = await Promise.all([
        read({ address: fv, abi: sdk.feeVaultAbi, functionName: 'claimable', args: [p.baseToken, a] }),
        read({ address: fv, abi: sdk.feeVaultAbi, functionName: 'claimable', args: [p.quoteToken, a] }),
      ]);
      console.log('ARL', p.pool, 'vault', fv, 'addr', a, 'base', cb.toString(), 'quote', cq.toString(), 'poolCreator', p.creator);
    }
  } catch (e) { console.log('ARL', p.pool, 'FAIL', String(e).slice(0, 120)); }
}
console.log('PROBE DONE');
