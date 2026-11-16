# Glean — Ammora Builder Mission Build

Status: app built and LIVE. X post text prepared, awaiting Leira's approval.
Nothing has been posted or submitted yet.

- **Product:** Glean (fixed brand name, identical in both UI languages)
- **Live:** https://leira-ai.github.io/glean/
- **Source:** https://github.com/Leira-ai/glean (app in repo root; build output on the `gh-pages` branch)
- **Stack:** `@ammora-protocol/sdk` 0.3.9 + viem, Vite + TypeScript, no framework. Same transport discipline as Slipway (see below).

## What Glean does

One job: find your money, claim your money. A visitor pastes any wallet
address (no wallet needed) and Glean sweeps every Ammora fee stream for that
address, reading live contract state on GIWA Sepolia. Amounts are shown per
stream with a per-token total. Connecting the owner's own wallet on GIWA
Sepolia enables per-item claims and Claim All (one wallet confirmation per
item). Claims are planned with the SDK planners first
(AmmoraV4LaunchCurveClient, RevenueCenterClient, DFSClient) and fall back to
the exact SDK-ABI calls those planners build. Transactions are only ever
signed by the visitor's wallet in their browser. No mainnet path exists in
the code; Leira's wallet and keys are never used.

UI languages: English (default) and Indonesian, switcher in the header,
every string translated in `src/i18n.ts`, choice persisted in localStorage
(`glean.v1.lang`). The name "Glean" is never translated.

## The six streams (how each amount is known, how it is claimed)

1. **Creator surplus** — for launches whose current creator is the address
   and whose curve status is 2 (ReadyToMigrate): the amount is the return
   value of simulating `claimSurplus()` from the creator. Claim: the same
   call (SDK V4 client `planClaimSurplus` first).
2. **Creator leftover** — same, status 3 (Migrated), simulating
   `withdrawLeftover()`. Claim: `planWithdrawLeftover` / direct call.
3. **Launch partner fees** — factory `poolCreationFeePartner(curve)` must
   equal the address; the amount is the return of simulating
   `claimPartnerPoolCreationFee(curve)` from the partner (net of the 10%
   protocol share). Paid in native ETH. Claim: factory call via
   RevenueCenterClient plan or direct.
4. **ALMM referral fees** — pool views `referralFeeBaseOwed(addr)` /
   `referralFeeQuoteOwed(addr)`. Claim: pool `claimReferralFee(token, to)`.
5. **Pool revenue (ARL)** — per concentrated pool, `feeVault()` then
   `claimable(token, addr)` on the vault. Claim: vault `claim(token, addr)`.
6. **Fee-sharing vaults (DFS/AFS)** — `DFSClient.getState()` per vault from
   both deployed fee-sharing factories; rows for recipients matching the
   address, amount = the vault's own `claimable`. Claim: `planClaim(index)`
   or direct `claim(index)`.

Discovery is an on-chain event scan from block 36,220,000 (10,000-block
`eth_getLogs` chunks, cached in localStorage with scanned-range
bookkeeping): launch factory `LaunchCreated`, ALMM factory `PoolCreated`,
concentrated factory `PoolCreated`, and `AFSVaultCreated` on both
fee-sharing factories (auto-route 0xb6131d1f… and legacy 0x6eb2b962…, the
latter scanned from block 32,500,768).

### Honesty rules implemented

- A verified zero (read succeeded, amount 0) renders as 0, collapsed under
  "Checked, nothing to claim (N)".
- A claim call that the contract itself reverts is shown as **Not yet
  claimable** — the read succeeded and the contract's answer is "not now".
- A stream whose reads fail (transport/RPC) is marked **could not be read**,
  never as zero; its absence of rows is not presented as proof of nothing.
- Raw RPC error text is never rendered.
- Dust amounts keep full precision (1 wei renders as
  0.000000000000000001, never as a rounded "0.000000").

## Live verification (16 Nov 2026, against the production RPC + live page)

Discovery from Node: 71 launches by 24 creators, 1 ALMM pool, 14
concentrated pools, 6 fee-sharing vaults (4 + 2 legacy). All 35 curves of
the two busiest creators read successfully through
`AmmoraV4LaunchCurveClient.getState()` (statuses: 21 trading, 1 ready to
migrate, 13 migrated).

Per-stream results for the busiest address
0x13cd27a6e337097db858c9c4fa472fbad2f2c637, reproduced identically on the
live page in a headless Chromium render:

- Surplus: the single status-2 curve (another creator's) simulated to
  1 wei WETH; for this address, none of its own curves are at status 2.
- Leftover: 7 curves claimable at 1 wei WETH each, 1 verified zero,
  5 curves revert with `MigrationNotReady()` despite status 3 → shown as
  Not yet claimable.
- Partner fees: partner recorded on ~all launches; 41 verified zeros
  (gross 0), and one real case below.
- ALMM referral: owed views read 0/0 for 8 candidate addresses (verified
  zeros; the single pool is nearly unused).
- ARL revenue (the substantial stream): claimable in the shared fee vault
  0x56f05c4514E426307BF3F7F20417ddC90698Bf32 — 296,086,000,000 wei WETH
  plus per-token amounts in 9 launch tokens (largest 246,887,728 units of
  AUICON and of ANRCON). `feeVault.claim` simulated from the owner returns
  exactly the displayed amount.
- DFS: recipient on 4 vaults, all claimable 0 (vaults fully claimed
  historically). A second address, 0x09A921496C544604C0Ef755710EC6A7bfd44613c,
  has a real claimable of 1 wei WETH in legacy vault
  0x3814D1E4d28E2006ed8e39378f523686E7d3F934 (50% share); the page shows it,
  and `claim(1)` simulated from that address returns exactly 1.

Browser checks (headless Chromium against the live URL, three runs):
page renders fully, block ticker live, lookups for both addresses return
the Node-verified data on the page itself, language toggle switches all
copy to Indonesian and back, the brand stays "Glean", the choice persists
across reload, empty states and the claim gate behave correctly, and no
raw RPC error text appears anywhere. Two defects were found and fixed
through these runs: RPC 429 throttling under sweep load (retries hardened
to 5 attempts with longer backoff), and the partner-fee revert case below
initially mislabeled as "could not read".

First sweep in a fresh browser takes ~5–7 minutes (full event scan through
the throttling public RPC); later sweeps resume from cache (measured 16 s).

## SDK surfaces that were unusable or needed care

- **AmmoraDataApiClient: not used.** `getLaunches` against
  https://ammora-giwa-sepolia-data.fly.dev failed from this environment
  (SDK-side "Body is unusable: Body has already been read"). All discovery
  is on-chain instead, which the SDK's own README sanctions as the fallback.
- **RevenueCenterClient's default reviewed deployment does not recognize
  the auto-route ALMM factory**: `planClaimALMMReferral` throws "factory
  0x63c9… is not recognized for liquidity-market-maker factories". Passing
  the deployment manifest as `deploymentSource` throws a TypeError (it
  expects a source object with `resolve()`). Glean therefore treats every
  planner as best-effort and falls back to the exact transaction the
  planner itself constructs (verified against the SDK source and by live
  simulation).
- **DFSClient.planClaim authenticates against the reviewed (legacy-slot)
  fee-sharing factory**: it plans fine for legacy vaults and throws for
  auto-route vaults; the fallback `claim(index)` is simulation-verified.
  `DFSClient.getState()` performs no factory check and reads both
  generations correctly.
- **Partner fee oddity (live):** curve 0xc0D1919C7D92209Eb72F9eA0d8073fFCb7BD682e
  has a configured pool creation fee of 1,000,000,000,000 wei with partner
  0x13cd27a6…, yet `claimPartnerPoolCreationFee` reverts with error
  0xd4d78487 (present in no SDK ABI), and zero `PoolCreationFeeClaimed`
  events exist deployment-wide. The page shows this as Not yet claimable.
- **ARL double-count trap:** the fee vault is shared by all concentrated
  pools and `claimable` is keyed by (token, beneficiary) only. Rows are
  built per (vault, token); a per-pool layout would have multiplied the
  WETH total 14 times.
- **Creator identity:** launch events name the original creator, but curve
  creator rights are transferable; Glean only builds creator rows when the
  curve's *current* creator matches the looked-up address.
- Transport (carried over from Slipway's proven fix): no `batch: true`,
  3-wide read queue, exponential backoff with jitter everywhere, only
  successful token metadata is cached, raw errors never rendered.

## Submission package (prepared, NOT sent)

X post draft: `builder-post.txt` in this folder (274 characters, English,
mentions @AmmoraHQ, claims only features verified live above).

Ammora submit payload shape (same signed `submit` action as the weekly
mission, via `~/workspace/ammora-s2/ammora_api.py`):

```json
{
  "kind": "builder",
  "url": "<the X post URL, filled in after posting>",
  "project": "Glean",
  "website": "https://leira-ai.github.io/glean/"
}
```
