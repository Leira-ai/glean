// Glean UI: one job — find your money, claim your money.
import { isAddress, type Address } from 'viem';
import {
  STREAMS,
  connectWallet,
  discover,
  executeClaim,
  formatAmount,
  getBlockNumber,
  lookup,
  shortAddr,
  tokenMeta,
  type ClaimRow,
  type Discovery,
  type LookupResult,
  type StreamId,
  type TokenMeta,
  type Wallet,
} from './chain';
import { applyI18n, getLang, setLang, t, type I18nKey } from './i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const blockTicker = $('blockTicker');
const connectBtn = $<HTMLButtonElement>('connectBtn');
const langEn = $<HTMLButtonElement>('langEn');
const langId = $<HTMLButtonElement>('langId');
const form = $<HTMLFormElement>('lookupForm');
const addrInput = $<HTMLInputElement>('addrInput');
const searchBtn = $<HTMLButtonElement>('searchBtn');
const useConnectedBtn = $<HTMLButtonElement>('useConnectedBtn');
const lookupMsg = $('lookupMsg');
const progress = $('progress');
const phaseLine = $('phaseLine');
const barFill = $('barFill');
const summary = $('summary');
const totalsList = $('totalsList');
const claimGate = $('claimGate');
const claimAllRow = $('claimAllRow');
const claimAllBtn = $<HTMLButtonElement>('claimAllBtn');
const results = $('results');
const resultsFor = $('resultsFor');
const streamCards = $('streamCards');
const emptyState = $('emptyState');

let wallet: Wallet | null = null;
let discoveryPromise: Promise<Discovery> | null = null;
let lastResult: LookupResult | null = null;
let lastAddress: Address | null = null;
const metas = new Map<string, TokenMeta>();
const claimed = new Set<string>();
const rowStatus = new Map<string, string>(); // transient per-row status line (tx hash / failure)

// ---------- language ----------
function syncLangButtons() {
  langEn.classList.toggle('active', getLang() === 'en');
  langId.classList.toggle('active', getLang() === 'id');
}
function switchLang(lang: 'en' | 'id') {
  setLang(lang);
  syncLangButtons();
  applyI18n();
  syncConnectButton();
  if (lastResult) void renderResults();
}
langEn.addEventListener('click', () => switchLang('en'));
langId.addEventListener('click', () => switchLang('id'));

// ---------- network ticker (warn only after 2 consecutive failed ticks) ----------
let tickFails = 0;
async function tickBlock() {
  try {
    const n = await getBlockNumber();
    tickFails = 0;
    blockTicker.textContent = t('net.block', { block: n.toString() });
  } catch {
    tickFails++;
    if (tickFails >= 2) blockTicker.textContent = t('net.unreachable');
  }
}

// ---------- wallet ----------
function syncConnectButton() {
  if (wallet) {
    connectBtn.textContent = t('wallet.connected', { short: shortAddr(wallet.address) });
    useConnectedBtn.classList.remove('hidden');
  } else {
    connectBtn.textContent = t('wallet.connect');
    useConnectedBtn.classList.add('hidden');
  }
}
connectBtn.addEventListener('click', async () => {
  lookupMsg.textContent = '';
  try {
    wallet = await connectWallet();
    syncConnectButton();
    if (lastResult) void renderResults();
  } catch (e) {
    lookupMsg.textContent = (e as Error).message === 'NO_WALLET' ? t('wallet.none') : t('wallet.rejected');
  }
});
useConnectedBtn.addEventListener('click', () => {
  if (!wallet) return;
  addrInput.value = wallet.address;
  form.requestSubmit();
});

// ---------- lookup ----------
form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const raw = addrInput.value.trim();
  if (!isAddress(raw)) {
    lookupMsg.textContent = t('lookup.invalid');
    return;
  }
  lookupMsg.textContent = '';
  void runLookup(raw as Address);
});

async function runLookup(address: Address) {
  searchBtn.disabled = true;
  progress.classList.remove('hidden');
  phaseLine.textContent = t('phase.discovery');
  barFill.style.width = '5%';
  summary.classList.add('hidden');
  results.classList.add('hidden');
  claimed.clear();
  rowStatus.clear();
  try {
    discoveryPromise ??= discover();
    const disc = await discoveryPromise;
    phaseLine.textContent = t('phase.checking', { done: '0', total: '…' });
    const result = await lookup(address, disc, (done, total) => {
      phaseLine.textContent = t('phase.checking', { done: String(done), total: String(total) });
      barFill.style.width = `${Math.min(100, Math.round((done / Math.max(1, total)) * 100))}%`;
    });
    lastResult = result;
    lastAddress = address;
    // Resolve display metadata for every token the rows mention.
    const needed = new Set<string>();
    for (const row of result.rows) {
      if (row.token) needed.add(row.token.toLowerCase());
      if (row.source.launchToken) needed.add(row.source.launchToken.toLowerCase());
      if (row.source.pair) for (const p of row.source.pair) needed.add(p.toLowerCase());
    }
    await Promise.all(
      [...needed].map(async (addr) => {
        if (!metas.has(addr)) metas.set(addr, await tokenMeta(addr as Address));
      }),
    );
    phaseLine.textContent = t('phase.done', { block: String(result.block) });
    barFill.style.width = '100%';
    await renderResults();
  } catch {
    phaseLine.textContent = t('net.unreachable');
  } finally {
    searchBtn.disabled = false;
    setTimeout(() => progress.classList.add('hidden'), 1200);
  }
}

function metaOf(token: Address | null): { symbol: string; decimals: number; name: string } {
  if (token === null) return { symbol: 'ETH', decimals: 18, name: 'Ether' };
  const m = metas.get(token.toLowerCase());
  if (m && m.resolved) return { symbol: m.symbol, decimals: m.decimals, name: m.name };
  return { symbol: shortAddr(token), decimals: 18, name: '' };
}

function rowLabel(row: ClaimRow): string {
  if (row.source.launchToken) {
    const m = metaOf(row.source.launchToken);
    const name = m.name ? `${m.name} (${m.symbol})` : m.symbol;
    return t('row.fromLaunch', { token: name });
  }
  if (row.source.pair) {
    const [a, b] = row.source.pair;
    return t('row.fromPool', { pair: `${metaOf(a).symbol} / ${metaOf(b).symbol}` });
  }
  if (row.source.vault) return t('row.fromVault', { short: shortAddr(row.source.vault) });
  return '';
}

function claimableRows(): ClaimRow[] {
  return (lastResult?.rows ?? []).filter((r) => r.state === 'claimable' && !claimed.has(r.key));
}

function renderTotals() {
  const totals = new Map<string, { amount: bigint; token: Address | null }>();
  for (const row of claimableRows()) {
    const key = row.token ? row.token.toLowerCase() : 'native';
    const cur = totals.get(key) ?? { amount: 0n, token: row.token };
    cur.amount += row.amount ?? 0n;
    totals.set(key, cur);
  }
  totalsList.innerHTML = '';
  if (totals.size === 0) {
    const p = document.createElement('p');
    p.className = 'total-none';
    p.textContent = t('summary.none');
    totalsList.appendChild(p);
  } else {
    for (const { amount, token } of totals.values()) {
      const m = metaOf(token);
      const div = document.createElement('div');
      div.className = 'total-item';
      div.innerHTML = `<span class="total-amount mono"></span> <span class="total-symbol"></span>`;
      div.querySelector('.total-amount')!.textContent = formatAmount(amount, m.decimals);
      div.querySelector('.total-symbol')!.textContent = m.symbol;
      totalsList.appendChild(div);
    }
  }
  // Claim gating
  const anyClaimable = claimableRows().length > 0;
  claimGate.textContent = '';
  claimAllRow.classList.add('hidden');
  if ((lastResult?.rows ?? []).some((r) => r.state === 'claimable')) {
    if (!wallet) claimGate.textContent = t('claim.connectFirst');
    else if (lastAddress && wallet.address.toLowerCase() !== lastAddress.toLowerCase()) claimGate.textContent = t('claim.notOwner');
    else if (anyClaimable) claimAllRow.classList.remove('hidden');
  }
}

async function renderResults() {
  if (!lastResult || !lastAddress) return;
  resultsFor.textContent = t('results.for', { addr: lastAddress });
  streamCards.innerHTML = '';
  const canClaim =
    wallet !== null && wallet.address.toLowerCase() === lastAddress.toLowerCase();

  for (const stream of STREAMS) {
    const all = lastResult.rows.filter((r) => r.stream === stream);
    const ok = lastResult.streamOk[stream];
    if (all.length === 0 && ok) continue; // nothing found and the sweep was clean: the empty state covers it
    const card = document.createElement('article');
    card.className = 'card stream-card';
    const titleKey = `stream.${stream}.title` as I18nKey;
    const aboutKey = `stream.${stream}.about` as I18nKey;
    const head = document.createElement('h3');
    head.textContent = t(titleKey);
    const about = document.createElement('p');
    about.className = 'stream-about';
    about.textContent = t(aboutKey);
    card.append(head, about);

    if (!ok) {
      const warn = document.createElement('p');
      warn.className = 'stream-warn';
      warn.textContent = t('stream.unavailable');
      card.appendChild(warn);
    }

    const live = all.filter((r) => r.state !== 'zero');
    const zeros = all.filter((r) => r.state === 'zero');
    const list = document.createElement('div');
    list.className = 'rows';
    for (const row of live) list.appendChild(renderRow(row, canClaim));
    card.appendChild(list);

    if (zeros.length > 0) {
      const det = document.createElement('details');
      det.className = 'zeros';
      const sum = document.createElement('summary');
      sum.textContent = t('row.checkedZero', { count: String(zeros.length) });
      det.appendChild(sum);
      const zlist = document.createElement('div');
      zlist.className = 'rows';
      for (const row of zeros) zlist.appendChild(renderRow(row, canClaim));
      det.appendChild(zlist);
      card.appendChild(det);
    }
    if (all.length === 0 && !ok) {
      // stream failed with no rows at all: the warning above is the content
    } else if (all.length === 0 && ok) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = t('stream.empty');
      card.appendChild(empty);
    }
    streamCards.appendChild(card);
  }

  const anyClaimable = lastResult.rows.some((r) => r.state === 'claimable');
  emptyState.classList.toggle(
    'hidden',
    anyClaimable || lastResult.rows.some((r) => r.state === 'unavailable' || r.state === 'notready'),
  );
  summary.classList.remove('hidden');
  results.classList.remove('hidden');
  renderTotals();
}

function renderRow(row: ClaimRow, canClaim: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';
  const left = document.createElement('div');
  left.className = 'row-left';
  const label = document.createElement('div');
  label.className = 'row-label';
  label.textContent = rowLabel(row);
  left.appendChild(label);
  const sub: string[] = [];
  if (row.role) sub.push(t(row.role === 'creator' ? 'row.role.creator' : 'row.role.referral'));
  if (row.shareText) sub.push(t('row.role.recipient', { share: row.shareText }));
  if (sub.length) {
    const s = document.createElement('div');
    s.className = 'row-sub';
    s.textContent = sub.join(' · ');
    left.appendChild(s);
  }
  const status = rowStatus.get(row.key);
  if (status) {
    const s = document.createElement('div');
    s.className = 'row-status mono';
    s.textContent = status;
    left.appendChild(s);
  }
  el.appendChild(left);

  const right = document.createElement('div');
  right.className = 'row-right';
  const amount = document.createElement('span');
  amount.className = 'row-amount mono';
  if (row.state === 'unavailable' || row.amount === null) {
    amount.textContent = row.state === 'notready' ? t('row.notReady') : t('row.unavailable');
    amount.classList.add('dim');
  } else {
    const m = metaOf(row.token);
    amount.textContent = `${formatAmount(row.amount, m.decimals)} ${m.symbol}`;
    if (row.state === 'zero') amount.classList.add('dim');
  }
  right.appendChild(amount);

  if (row.state === 'claimable') {
    if (claimed.has(row.key)) {
      const doneTag = document.createElement('span');
      doneTag.className = 'claimed-tag';
      doneTag.textContent = t('row.claimed');
      right.appendChild(doneTag);
    } else if (canClaim) {
      const btn = document.createElement('button');
      btn.className = 'btn primary small';
      btn.type = 'button';
      btn.textContent = t('row.claim');
      btn.addEventListener('click', () => void claimRow(row, btn));
      right.appendChild(btn);
    }
  }
  el.appendChild(right);
  return el;
}

async function claimRow(row: ClaimRow, btn?: HTMLButtonElement): Promise<boolean> {
  if (!wallet) return false;
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('claim.sending');
  }
  try {
    const hash = await executeClaim(wallet, row);
    claimed.add(row.key);
    rowStatus.set(row.key, t('claim.done', { hash: `${hash.slice(0, 10)}…` }));
    await renderResults();
    return true;
  } catch {
    rowStatus.set(row.key, t('claim.failed'));
    await renderResults();
    return false;
  }
}

claimAllBtn.addEventListener('click', async () => {
  claimAllBtn.disabled = true;
  for (const row of claimableRows()) {
    await claimRow(row);
  }
  claimAllBtn.disabled = false;
});

// ---------- init ----------
document.documentElement.lang = getLang() === 'id' ? 'id' : 'en';
syncLangButtons();
applyI18n();
syncConnectButton();
void tickBlock();
setInterval(() => void tickBlock(), 20_000);
