// Glean i18n: every UI string lives here in English and Indonesian.
// The product name "Glean" is a fixed brand name: it is never translated
// and never appears as a dictionary value.
export type Lang = 'en' | 'id';

const LS_KEY = 'glean.v1.lang';

const dict = {
  en: {
    'tagline': 'Ammora claim center',
    'net.connecting': 'GIWA Sepolia · connecting…',
    'net.block': 'GIWA Sepolia · block {block}',
    'net.unreachable': 'GIWA Sepolia · connection hiccup, retrying…',
    'wallet.connect': 'Connect wallet',
    'wallet.connected': 'Connected {short}',
    'wallet.none': 'No browser wallet found. Install a wallet extension to connect.',
    'wallet.rejected': 'Wallet connection was rejected.',
    'hero.title': 'Find your money.<br />Claim your money.',
    'hero.lede':
      'Fees and earnings pile up across Ammora in small corners: a launch you created, a pool you referred traders to, a fee-sharing vault that lists you as a recipient. Glean sweeps every one of those corners for any wallet address and shows exactly what can be claimed, read live from the contracts on GIWA Sepolia testnet.',
    'lookup.label': 'Wallet address to inspect',
    'lookup.placeholder': '0x…',
    'lookup.button': 'Find claimable funds',
    'lookup.useConnected': 'Use my connected wallet',
    'lookup.invalid': 'That does not look like a valid wallet address.',
    'lookup.hint': 'Read-only: looking up an address never moves funds and needs no wallet.',
    'phase.discovery': 'Discovering launches, pools and vaults on chain…',
    'phase.checking': 'Checking fee streams… {done}/{total}',
    'phase.done': 'Sweep complete at block {block}.',
    'summary.title': 'Total claimable',
    'summary.none': 'Nothing claimable right now.',
    'summary.note': 'Totals add up only amounts the contracts confirmed as claimable in this sweep.',
    'results.for': 'Results for {addr}',
    'stream.surplus.title': 'Creator surplus',
    'stream.surplus.about':
      'When a launch fills its curve, part of the money raised is set aside as creator surplus. It becomes claimable by the launch creator as soon as the curve is ready to migrate.',
    'stream.leftover.title': 'Creator leftover',
    'stream.leftover.about':
      'After a launch migrates to its pool, a leftover balance can remain on the curve. The creator can withdraw it.',
    'stream.partner.title': 'Launch partner fees',
    'stream.partner.about':
      'Every launch pays a pool creation fee. If you were the launch partner recorded for a launch, your share of that fee waits at the factory for you to claim, paid in ETH.',
    'stream.almm.title': 'ALMM referral fees',
    'stream.almm.about':
      'When traders you referred swap in an ALMM bin pool, a slice of the protocol fee is credited to you inside the pool, per token.',
    'stream.arl.title': 'Pool revenue (ARL)',
    'stream.arl.about':
      'Concentrated pools route part of their protocol fee through a fee vault. Pool creators and referrers can claim their share from that vault.',
    'stream.dfs.title': 'Fee-sharing vaults',
    'stream.dfs.about':
      'Fee-sharing vaults split fee income among fixed recipients. If a vault lists your address, your share accrues there until you claim it.',
    'row.claim': 'Claim',
    'row.claimed': 'Claimed',
    'row.zero': 'Nothing to claim',
    'row.checkedZero': 'Checked, nothing to claim ({count})',
    'row.unavailable': 'Could not read this right now',
    'row.notReady': 'Not yet claimable',
    'row.role.creator': 'as pool creator',
    'row.role.referral': 'as referrer',
    'row.role.recipient': 'recipient share {share}',
    'row.fromLaunch': 'Launch {token}',
    'row.fromPool': 'Pool {pair}',
    'row.fromVault': 'Vault {short}',
    'row.unnamed': 'Unnamed token',
    'claim.connectFirst': 'Connect the wallet that owns these funds to claim.',
    'claim.notOwner': 'The connected wallet is not the address these funds belong to.',
    'claim.all': 'Claim all',
    'claim.allNote': 'One wallet confirmation per item.',
    'claim.sending': 'Waiting for wallet…',
    'claim.confirming': 'Confirming on chain…',
    'claim.done': 'Claimed. Transaction {hash}',
    'claim.failed': 'That claim did not go through. Nothing was claimed for this item.',
    'stream.unavailable': 'This stream could not be read in this sweep. That is not the same as zero: try again in a moment.',
    'stream.empty': 'Nothing found in this stream for this address.',
    'empty.title': 'No claimable funds found',
    'empty.body':
      'Every stream was read live and none of them owes this address anything right now. Fees appear here only after the activity that earns them: launching a token, referring traders, creating a pool, or being listed in a fee-sharing vault.',
    'how.title': 'Where the money comes from',
    'how.body':
      'Ammora splits its protocol fees among the people who create activity: launch creators, launch partners, referrers, pool creators and fee-sharing recipients. Those shares do not arrive automatically. They sit in the protocol contracts until the owner claims them, which is the sweep Glean runs for you.',
    'footer.note':
      'Glean runs on GIWA Sepolia testnet only. Every amount is read live from Ammora contracts through the official SDK at the moment of the sweep; nothing is estimated and nothing is cached as a balance. Claims are signed only by your own wallet in your browser. Glean never holds keys and never touches mainnet.',
    'scanning.note': 'First sweep scans the chain from the deployment block; later sweeps resume from cache.',
  },
  id: {
    'tagline': 'Pusat klaim Ammora',
    'net.connecting': 'GIWA Sepolia · menyambungkan…',
    'net.block': 'GIWA Sepolia · blok {block}',
    'net.unreachable': 'GIWA Sepolia · koneksi tersendat, mencoba lagi…',
    'wallet.connect': 'Hubungkan wallet',
    'wallet.connected': 'Terhubung {short}',
    'wallet.none': 'Tidak ada wallet browser yang ditemukan. Pasang ekstensi wallet untuk menghubungkan.',
    'wallet.rejected': 'Koneksi wallet ditolak.',
    'hero.title': 'Temukan uangmu.<br />Klaim uangmu.',
    'hero.lede':
      'Fee dan penghasilan menumpuk di sudut-sudut kecil Ammora: launch yang kamu buat, pool yang kamu beri rujukan trader, vault bagi hasil yang mencantumkan namamu sebagai penerima. Glean menyapu semua sudut itu untuk alamat wallet mana pun dan menunjukkan persis apa yang bisa diklaim, dibaca langsung dari kontrak di testnet GIWA Sepolia.',
    'lookup.label': 'Alamat wallet yang ingin diperiksa',
    'lookup.placeholder': '0x…',
    'lookup.button': 'Cari dana yang bisa diklaim',
    'lookup.useConnected': 'Pakai wallet saya yang terhubung',
    'lookup.invalid': 'Itu sepertinya bukan alamat wallet yang valid.',
    'lookup.hint': 'Hanya baca: memeriksa alamat tidak pernah memindahkan dana dan tidak butuh wallet.',
    'phase.discovery': 'Menemukan launch, pool, dan vault di chain…',
    'phase.checking': 'Memeriksa aliran fee… {done}/{total}',
    'phase.done': 'Penyapuan selesai di blok {block}.',
    'summary.title': 'Total bisa diklaim',
    'summary.none': 'Tidak ada yang bisa diklaim saat ini.',
    'summary.note': 'Total hanya menjumlahkan nominal yang dikonfirmasi kontrak sebagai bisa diklaim dalam penyapuan ini.',
    'results.for': 'Hasil untuk {addr}',
    'stream.surplus.title': 'Surplus kreator',
    'stream.surplus.about':
      'Saat sebuah launch memenuhi kurvanya, sebagian dana yang terkumpul disisihkan sebagai surplus kreator. Surplus itu bisa diklaim kreator launch begitu kurva siap migrasi.',
    'stream.leftover.title': 'Sisa dana kreator',
    'stream.leftover.about':
      'Sesudah launch bermigrasi ke pool-nya, saldo sisa bisa tertinggal di kurva. Kreator dapat menariknya.',
    'stream.partner.title': 'Fee partner launch',
    'stream.partner.about':
      'Setiap launch membayar fee pembuatan pool. Bila kamu tercatat sebagai partner untuk sebuah launch, bagianmu dari fee itu menunggu di factory untuk kamu klaim, dibayar dalam ETH.',
    'stream.almm.title': 'Fee referral ALMM',
    'stream.almm.about':
      'Saat trader yang kamu rujuk bertukar di pool bin ALMM, sebagian fee protokol dikreditkan kepadamu di dalam pool, per token.',
    'stream.arl.title': 'Pendapatan pool (ARL)',
    'stream.arl.about':
      'Pool concentrated menyalurkan sebagian fee protokolnya lewat fee vault. Kreator pool dan pemberi rujukan dapat mengklaim bagian mereka dari vault itu.',
    'stream.dfs.title': 'Vault bagi hasil',
    'stream.dfs.about':
      'Vault bagi hasil membagi pendapatan fee ke penerima tetap. Bila sebuah vault mencantumkan alamatmu, bagianmu menumpuk di sana sampai kamu mengklaimnya.',
    'row.claim': 'Klaim',
    'row.claimed': 'Sudah diklaim',
    'row.zero': 'Tidak ada yang bisa diklaim',
    'row.checkedZero': 'Sudah diperiksa, tidak ada yang bisa diklaim ({count})',
    'row.unavailable': 'Tidak bisa dibaca saat ini',
    'row.notReady': 'Belum bisa diklaim',
    'row.role.creator': 'sebagai kreator pool',
    'row.role.referral': 'sebagai pemberi rujukan',
    'row.role.recipient': 'bagian penerima {share}',
    'row.fromLaunch': 'Launch {token}',
    'row.fromPool': 'Pool {pair}',
    'row.fromVault': 'Vault {short}',
    'row.unnamed': 'Token tanpa nama',
    'claim.connectFirst': 'Hubungkan wallet pemilik dana ini untuk mengklaim.',
    'claim.notOwner': 'Wallet yang terhubung bukan alamat pemilik dana ini.',
    'claim.all': 'Klaim semua',
    'claim.allNote': 'Satu konfirmasi wallet per item.',
    'claim.sending': 'Menunggu wallet…',
    'claim.confirming': 'Mengonfirmasi di chain…',
    'claim.done': 'Berhasil diklaim. Transaksi {hash}',
    'claim.failed': 'Klaim itu tidak berhasil. Tidak ada yang diklaim untuk item ini.',
    'stream.unavailable': 'Aliran ini tidak bisa dibaca dalam penyapuan ini. Itu berbeda dengan nol: coba lagi sebentar lagi.',
    'stream.empty': 'Tidak ada apa pun di aliran ini untuk alamat ini.',
    'empty.title': 'Tidak ada dana yang bisa diklaim',
    'empty.body':
      'Semua aliran dibaca langsung dan tidak satu pun berutang apa pun ke alamat ini saat ini. Fee muncul di sini hanya sesudah aktivitas yang menghasilkannya: meluncurkan token, merujuk trader, membuat pool, atau tercantum di vault bagi hasil.',
    'how.title': 'Dari mana uang ini berasal',
    'how.body':
      'Ammora membagi fee protokolnya kepada orang-orang yang menciptakan aktivitas: kreator launch, partner launch, pemberi rujukan, kreator pool, dan penerima bagi hasil. Bagian itu tidak datang otomatis. Ia diam di kontrak protokol sampai pemiliknya mengklaim, dan itulah penyapuan yang Glean jalankan untukmu.',
    'footer.note':
      'Glean hanya berjalan di testnet GIWA Sepolia. Setiap nominal dibaca langsung dari kontrak Ammora lewat SDK resmi pada saat penyapuan; tidak ada yang diperkirakan dan tidak ada saldo yang disimpan sebagai cache. Klaim hanya ditandatangani oleh wallet milikmu sendiri di browsermu. Glean tidak pernah memegang kunci dan tidak pernah menyentuh mainnet.',
    'scanning.note': 'Penyapuan pertama memindai chain dari blok deployment; penyapuan berikutnya melanjutkan dari cache.',
  },
} as const;

export type I18nKey = keyof (typeof dict)['en'];

let current: Lang = 'en';
try {
  const saved = localStorage.getItem(LS_KEY);
  if (saved === 'id' || saved === 'en') current = saved;
} catch {
  /* storage unavailable: stay on English */
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = lang === 'id' ? 'id' : 'en';
}

export function t(key: I18nKey, params?: Record<string, string>): string {
  let s: string = dict[current][key] ?? dict.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

/** Apply the dictionary to every [data-i18n] element in the static shell. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n') as I18nKey;
    el.innerHTML = t(key);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder') as I18nKey;
    el.placeholder = t(key);
  });
}
