# Glean

**Find your money. Claim your money.**

Glean is a claim center for the Ammora protocol on GIWA Sepolia testnet.
Fees and earnings pile up across Ammora in small corners: creator surplus on
a launch curve, a launch partner's share of the pool creation fee, referral
fees inside an ALMM pool, pool revenue in a fee vault, a recipient share in a
fee-sharing vault. None of it arrives automatically. Glean sweeps every one
of those corners for any wallet address and shows exactly what can be
claimed, read live from the contracts through the official
`@ammora-protocol/sdk`.

- **Read-only lookup first.** Paste any address: no wallet needed. Every
  amount comes from a live contract read or an `eth_call` simulation at
  sweep time. A stream that cannot be read is shown as unreadable, never as
  a fabricated zero; a verified zero and a "not yet claimable" answer are
  shown as what they are.
- **Claims from your own wallet only.** Connect a wallet on GIWA Sepolia
  and claim each stream, or all of them. Transactions are planned with the
  SDK (AmmoraV4LaunchCurveClient, RevenueCenterClient, DFSClient) and signed
  only by the visitor's wallet in their browser. Testnet only; there is no
  mainnet path in the code.
- **English / Indonesian UI.** The language switcher in the header toggles
  the full interface between English and Bahasa Indonesia and remembers the
  choice.

Live: https://leira-ai.github.io/glean/

## Streams covered

1. Creator surplus (V4 launch curves ready to migrate)
2. Creator leftover (migrated launch curves)
3. Launch partner pool creation fees (paid in native ETH)
4. ALMM referral fees (per pool, per token)
5. Pool revenue / ARL (fee vault balances, aggregated per vault and token)
6. Fee-sharing vault (DFS/AFS) recipient shares, across both deployed
   fee-sharing factories

Discovery is an on-chain event scan from the deployment block (launch
factory, ALMM factory, concentrated factory, both fee-sharing factories),
cached in the browser with scanned-range bookkeeping. The public GIWA RPC
throttles concurrent `eth_call` bursts, so all reads run through a narrow
queue with retries and no batched transport.

## Develop

```sh
npm install
npm run dev     # local dev server
npm run build   # type-check + production build into dist/
```

Built with `@ammora-protocol/sdk` 0.3.9 and viem. MIT.
