import { createPublicClient, http, defineChain } from 'viem';
import * as sdk from '@ammora-protocol/sdk';
import { readFileSync } from 'fs';
const RPC = 'https://sepolia-rpc.giwa.io';
const chain = defineChain({ id: 91342, name: 'GIWA Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const client = createPublicClient({ chain, transport: http(RPC, { timeout: 30000, retryCount: 3, retryDelay: 600 }) });
const A1 = '0x13cd27a6e337097db858c9c4fa472fbad2f2c637';
const A2 = '0xd57ab6c1f5618e03074c78f11f6ee2c726496bf1';
const DFSGUY = '0x09A921496C544604C0Ef755710EC6A7bfd44613c';
const poolAbi = sdk.ammoraLaunchPoolV4Abi;

// (a) leftover revert reason + current creator
const badCurve = '0xffA37cACe48080C818dEF73AC9EA5AdF861002E4';
try {
  const creator = await client.readContract({ address: badCurve, abi: poolAbi, functionName: 'creator' });
  console.log('(a) current creator of reverted curve:', creator, 'event creator was A1:', A1);
} catch (e) { console.log('(a) creator read fail', String(e).slice(0, 150)); }
try {
  await client.simulateContract({ address: badCurve, abi: poolAbi, functionName: 'withdrawLeftover', account: A1 });
  console.log('(a) sim unexpectedly OK');
} catch (e) {
  console.log('(a) revert detail:', e.cause?.data?.errorName ?? e.cause?.reason ?? '', '|', String(e.shortMessage ?? '').slice(0, 160), '| cause:', String(e.cause?.message ?? '').slice(0, 200));
}

// (b) RevenueCenter with explicit auto-route deploymentSource
const rcAuto = new sdk.RevenueCenterClient(client, { deploymentSource: sdk.giwaSepoliaAutoRouteDeployment });
const disc = JSON.parse(readFileSync('discovery.json', 'utf8'));
const almmPool = disc.almmPools[0];
try {
  const plan = await rcAuto.planClaimALMMReferral({ pool: almmPool.pool, token: almmPool.baseToken, beneficiary: A1 });
  console.log('(b) ALMM plan with AUTO source OK, claimable', plan.claimable.toString());
} catch (e) { console.log('(b) ALMM plan with AUTO source FAIL:', String(e).slice(0, 180)); }
const arlPool = disc.concPools[0];
try {
  const fv = await client.readContract({ address: arlPool.pool, abi: sdk.ammConcentratedPoolV3Abi, functionName: 'feeVault' });
  const plan = await rcAuto.planClaimARLRevenue({ pool: arlPool.pool, token: arlPool.quoteToken, beneficiary: A1 });
  console.log('(b) ARL plan with AUTO source OK, claimable', plan.claimable.toString(), 'vault', fv, 'txTo', plan.transaction.to);
  // (e) simulate the feeVault claim directly
  const simr = await client.simulateContract({ address: fv, abi: sdk.feeVaultAbi, functionName: 'claim', args: [arlPool.quoteToken, A1], account: A1 });
  console.log('(e) feeVault.claim sim result:', simr.result.toString());
} catch (e) { console.log('(b/e) ARL plan/sim FAIL:', String(e).slice(0, 180)); }
try {
  const plan = await rcAuto.planClaimALCPartnerPoolCreationFee({ curve: '0xA307e9125B6F1c235a0D4e98b99c1BF9990d0BE0', beneficiary: A1 });
  console.log('(b) Partner plan with AUTO source OK, claimable', plan.claimable.toString(), 'gross', plan.grossAmount.toString());
} catch (e) { console.log('(b) Partner plan with AUTO source FAIL:', String(e).slice(0, 180)); }

// (c) DFS planClaim variants
const legacyVault = '0x3814D1E4d28E2006ed8e39378f523686E7d3F934';
try {
  const dc = new sdk.DFSClient(client, legacyVault);
  const tx = dc.planClaim(1, DFSGUY);
  const simr = await client.simulateContract({ address: tx.to, abi: sdk.ammoraAFSVaultAbi, functionName: 'claim', args: [1], account: DFSGUY });
  console.log('(c) DFS legacy planClaim default OK, sim claim result:', simr.result.toString());
} catch (e) { console.log('(c) DFS legacy planClaim default FAIL:', String(e).slice(0, 180)); }
try {
  const dc = new sdk.DFSClient(client, '0xDd79B094ad92DEb0a4003B77FE32Ca33dcD820dB', { deploymentSource: sdk.giwaSepoliaAutoRouteDeployment });
  const tx = dc.planClaim(0, A1);
  console.log('(c) DFS new-vault planClaim with AUTO source OK, txTo', tx.to);
} catch (e) { console.log('(c) DFS new-vault planClaim with AUTO source FAIL:', String(e).slice(0, 180)); }

// (d) V4 planClaimSurplus + simulate planned tx
try {
  const vc = new sdk.AmmoraV4LaunchCurveClient(client, '0x307d0a2fEad69af1920E66B99C14fe4D077A4E81', { launchFactory: '0x35353a2Dab7426EcCAe6f5FB267702a542ab68fA', feePolicy: '0x17B44C14F640fD429740FA3220f47a567c62725C' });
  const plan = await vc.planClaimSurplus(A2);
  const r = await client.call({ account: A2, to: plan.transaction.to, data: plan.transaction.data });
  console.log('(d) planClaimSurplus OK; eth_call of planned tx returned data len', (r.data ?? '0x').length);
} catch (e) { console.log('(d) planClaimSurplus FAIL:', String(e).slice(0, 180)); }

// (f) token metas for ARL pool tokens
import { erc20Abi } from 'viem';
const seen = new Set();
for (const p of disc.concPools.slice(0, 4)) {
  for (const tk of [p.baseToken, p.quoteToken]) {
    if (seen.has(tk)) continue; seen.add(tk);
    try {
      const [n, s, d] = await Promise.all([
        client.readContract({ address: tk, abi: erc20Abi, functionName: 'name' }),
        client.readContract({ address: tk, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: tk, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      console.log('(f) token', tk, '=', n, `(${s}, ${d} decimals)`);
    } catch (e) { console.log('(f) token', tk, 'meta FAIL'); }
  }
}
console.log('PROBE3 DONE');
