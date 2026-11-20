// Preflight's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks pre-token protocols by the token value their record implies. Every input is a field
// the snapshot itself carries — TVL, seven-day growth, the day DefiLlama began tracking the protocol,
// and its chains — and one function scores every row: no name is special-cased anywhere.
//
//   sizeMult        = clamp(SIZE_CEILING - SIZE_SLOPE x log10(tvl / SIZE_ANCHOR), SIZE_FLOOR, SIZE_CEILING)
//   growthMult      = 1 + clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) / 100 x GROWTH_WEIGHT
//   anticipationMult= ANTICIPATION_FLOOR + min(age_days, ANTICIPATION_DAYS) / ANTICIPATION_DAYS x ANTICIPATION_RANGE
//   breadthMult     = 1 + min(chains, BREADTH_CAP) x BREADTH_WEIGHT
//   implied_value   = round(tvl x BASE_MULTIPLE x sizeMult x growthMult x anticipationMult x breadthMult)
//
// Why each factor is there:
// - BASE_MULTIPLE x sizeMult is the FDV a launch clears per dollar of TVL. Comparable launches clear
//   roughly 0.4x to 1.2x TVL, and the multiple falls as TVL rises: a $10M protocol launching into an
//   attentive market clears a richer multiple than a $5B one, whose float would swamp it. The log
//   slope encodes that decay; the anchor is $10M of TVL.
// - growthMult lets seven-day momentum raise or lower the launch valuation, clamped so one wild week
//   cannot dominate the board (mercenary TVL that pumps 120% then leaves is capped like a collapse).
// - anticipationMult rises with how long the protocol has run with no token: a longer silence means
//   more accrued usage for a launch to reward, and a launch that is more anticipated. An unknown age
//   scores the midpoint of a typical points program, UNKNOWN_AGE_DAYS.
// - breadthMult nudges up protocols live on more chains: more chains, more users a launch token has
//   to reward.
//
// The board is the watchlist plus every other launch subject the same ten fields can name. A launch
// subject is a protocol that records no token (no market cap, no CoinGecko id, no symbol) and is not a
// wrapped, staked or bridged product of a token that already trades: the snapshot's own watchlist rule
// excludes the Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX
// categories, names ending in a version marker, names carrying a whole-word wrapped/staked/staking,
// and names beginning with a large exchange's name — the same test is applied here, from the ten
// fields each row carries. The watchlist is always covered: it is the floor, never the ceiling.
//
// Farm plans are generated from the same record — category decides the actions, chains decide where to
// deploy and what gas costs, TVL sizes the capital, age sizes the holding window.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard's model panel and changeable in one place. */
export interface ModelConstants {
  base_multiple: number;
  size_anchor_tvl: number;
  size_ceiling: number;
  size_slope: number;
  size_floor: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  anticipation_floor: number;
  anticipation_range: number;
  anticipation_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.55,
  size_anchor_tvl: 10_000_000,
  size_ceiling: 1.65,
  size_slope: 0.3,
  size_floor: 0.55,
  growth_floor: -60,
  growth_cap: 120,
  growth_weight: 0.5,
  anticipation_floor: 0.9,
  anticipation_range: 0.5,
  anticipation_days: 1095,
  unknown_age_days: 540,
  breadth_weight: 0.04,
  breadth_cap: 10,
};

/** The model's version label, named on the page and in the detail view. */
export const MODEL_VERSION = 'preflight-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** Round to four decimals: the multipliers the board carries are the multipliers the value uses, so the page can recompute it exactly. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from the snapshot's as_of back to listed_at; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole-word wrapped, staked or staking in the name: a product of an asset that already trades. */
const WRAPPED_STAKED = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with a large exchange's name: the exchange's own product, not a launch subject. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
/** Categories whose products ride on a token that already trades, per the snapshot's own watchlist rule. */
const PRODUCT_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Whether a protocol is a subject a token launch can reward: pre-token and not another token's product. */
export function isLaunchSubject(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_STAKED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The multipliers and the implied value one protocol gets under the model. */
export interface ValueBreakdown {
  implied: number;
  sizeMult: number;
  growthPct: number;
  growthMult: number;
  anticipationMult: number;
  breadthMult: number;
  age: number | null;
}

/** One function scores every protocol: the inputs are the snapshot's own fields, nothing else. */
export function impliedValue(p: SnapshotProtocol, asOf: string, m: ModelConstants): ValueBreakdown {
  const age = ageDays(asOf, p.listed_at);
  const sizeMult = round4(
    Math.min(m.size_ceiling, Math.max(m.size_floor, m.size_ceiling - m.size_slope * Math.log10(Math.max(p.tvl_usd, 1) / m.size_anchor_tvl))),
  );
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, finite(p.change_7d, 0)));
  const growthMult = round4(1 + (growthPct / 100) * m.growth_weight);
  const ageForModel = age ?? m.unknown_age_days;
  const anticipationMult = round4(
    m.anticipation_floor + (Math.min(Math.max(ageForModel, 0), m.anticipation_days) / m.anticipation_days) * m.anticipation_range,
  );
  const breadthMult = round4(1 + Math.min(p.chains.length, m.breadth_cap) * m.breadth_weight);
  const implied = Math.max(1, Math.round(p.tvl_usd * m.base_multiple * sizeMult * growthMult * anticipationMult * breadthMult));
  return { implied, sizeMult, growthPct, growthMult, anticipationMult, breadthMult, age };
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  signal: number;
  model: {
    base_multiple: number;
    size_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    anticipation_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan carried whole. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  signal: number;
  size_multiple: number;
  growth_multiplier: number;
  anticipation_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model that scored them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  median_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

// ---------------------------------------------------------------- farm plans

/** The chain a plan deploys on: the cheapest well-known chain the protocol is live on, else its first. */
const CHEAP_CHAINS = [
  'Base',
  'Arbitrum',
  'Optimism',
  'Polygon',
  'Solana',
  'BSC',
  'Avalanche',
  'Hyperliquid L1',
  'Monad',
  'Plasma',
];
export function deployChain(p: SnapshotProtocol): string {
  for (const cheap of CHEAP_CHAINS) if (p.chains.includes(cheap)) return cheap;
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on `chain`, in the words a plan step quotes. */
export function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'solana') return 'under $0.05 of fees a transaction';
  if (['base', 'arbitrum', 'optimism', 'polygon', 'plasma', 'monad', 'bsc'].includes(c)) return 'under $0.50 of gas a transaction';
  if (c === 'ethereum') return '$3 to $12 of gas a transaction';
  return 'under $1 of gas a transaction';
}

/** How much capital one farm position needs, sized from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 200_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold: a younger protocol gets a longer window before its launch is likely. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 120) return 90;
  if (age < 365) return 60;
  return 45;
}

/** A step as one string — action, then its cost, then its time — within the gate's 20..600 characters. */
export function stepText(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/**
 * One protocol's farm plan: six concrete steps derived from its record — the category decides the
 * actions, the chains decide where to deploy and what gas costs, the TVL sizes the capital, the age
 * sizes the window. No name is special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const name = p.name;
  const chain = deployChain(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const c = (p.category ?? '').toLowerCase();
  const common = [
    stepText(
      `Open a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline.`,
      `about $2 to move funds in, plus the position itself`,
      `10 minutes`,
    ),
    stepText(
      `Make one small qualifying action in ${name} every week — a deposit, a borrow, a swap or a vote, whichever the plan above uses.`,
      `${gas}`,
      `10 minutes a week`,
    ),
    stepText(
      `Hold the position for at least ${hold} days, so your wallet appears in more than one monthly snapshot of users.`,
      `the $${capital} stays deployed while you hold`,
      `${hold} days`,
    ),
    stepText(
      `Before you withdraw, open ${name}'s own points or rewards page and follow only links it publishes there — never pay anyone to claim.`,
      `nothing to check, and never a fee to claim`,
      `10 minutes`,
    ),
    stepText(
      `Log the wallet, the dates and every transaction, so you can prove the history or unwind it position by position.`,
      `nothing but the note-taking`,
      `5 minutes`,
    ),
  ];
  let opener: string;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    opener = stepText(
      `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow about a quarter of it in the chain's blue-chip asset.`,
      `$${capital} of capital, plus ${gas}`,
      `20 minutes to set up`,
    );
    common.splice(1, 0, stepText(
      `Repay half the borrow a week later, then borrow it again — a borrow and a repay are the two actions lending launches weight most.`,
      `${gas}, and the borrow's interest at the market rate`,
      `15 minutes a week`,
    ));
  } else if (c.includes('perp') || c.includes('derivative')) {
    opener = stepText(
      `Deposit $${capital} of USDC as margin on ${name} through ${chain} and open one position at two-times leverage or less.`,
      `$${capital} of margin, plus ${gas}`,
      `20 minutes to set up`,
    );
    common.splice(1, 0, stepText(
      `Keep the position open through the week and close part of it, so both volume and open interest land in your record; funding is the plan's running cost.`,
      `funding and spread, typically $1 to $3 a week at this size`,
      `15 minutes a week`,
    ));
  } else if (c.includes('basis')) {
    opener = stepText(
      `Deposit $${capital} into ${name}'s basis vault on ${chain}: the vault holds the delta-neutral pair the protocol runs.`,
      `$${capital} of capital, plus ${gas}`,
      `20 minutes to set up`,
    );
  } else if (c.includes('dex') || c.includes('market') || c.includes('swap')) {
    opener = stepText(
      `Swap $20 of ${chain}'s main asset through ${name}'s busiest pair — volume on the flagship pool is what launch reward formulas count.`,
      `$20 of trade value, plus ${gas}`,
      `10 minutes`,
    );
    common.splice(1, 0, stepText(
      `Provide $${capital} of liquidity, split half and half between the pair's two tokens, and leave it for the window; its value drifts with the pool's price.`,
      `$${capital} of capital, plus ${gas}`,
      `15 minutes to set up`,
    ));
  } else if (c.includes('prediction')) {
    opener = stepText(
      `Fund $${capital} on ${name} through ${chain} and take one position in its most liquid market; hold it, then take the other side next week.`,
      `$${capital} at stake, plus ${gas}`,
      `20 minutes to set up`,
    );
  } else if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('yield')) {
    opener = stepText(
      `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} through its own app, and keep the receipt token in the same wallet.`,
      `$${capital} of capital, plus ${gas}`,
      `15 minutes to set up`,
    );
  } else if (c.includes('rwa')) {
    opener = stepText(
      `Complete ${name}'s KYC and whitelist your farming wallet, then mint $${capital} of its yield-bearing token on ${chain} and hold it.`,
      `$${capital} of capital; KYC asks for identity documents, never for money`,
      `30 minutes, plus 1 to 5 days for approval`,
    );
  } else if (c.includes('staking pool') || c.includes('staked') || c.includes('restak')) {
    opener = stepText(
      `Stake $${capital} of ${chain}'s native staking asset through ${name} and keep the liquid receipt in the same wallet.`,
      `$${capital} of capital, plus ${gas}`,
      `15 minutes to set up`,
    );
  } else if (c.includes('bridge')) {
    opener = stepText(
      `Route $${capital} of USDC from ${chain} to one other chain ${name} serves, then route it back a week later — routed volume is what a bridge launch rewards.`,
      `$${capital} passing through, plus ${gas} on each leg`,
      `15 minutes, then a repeat in week two`,
    );
  } else if (c.includes('insurance') || c.includes('cover')) {
    opener = stepText(
      `Buy $${capital} of cover from ${name} on ${chain} for the longest term it sells, and keep the policy in the same wallet.`,
      `$${capital} of cover premium, plus ${gas}`,
      `15 minutes to set up`,
    );
  } else if (c.includes('stable')) {
    opener = stepText(
      `Mint $${capital} of ${name}'s stable asset on ${chain} from its own app, hold it, and mint or redeem a small amount again each week.`,
      `$${capital} of collateral, plus ${gas}`,
      `20 minutes to set up`,
    );
  } else {
    opener = stepText(
      `Deposit $${capital} of USDC into ${name} on ${chain} through its own app, and leave the position open for the window.`,
      `$${capital} of capital, plus ${gas}`,
      `15 minutes to set up`,
    );
  }
  // The wallet comes first, then the category's opening position, then the weekly rhythm, the hold,
  // the claim hygiene and the log — each step with its cost and its time.
  return [common[0], opener, ...common.slice(1)];
}

// ---------------------------------------------------------------- the board

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((x): x is string => typeof x === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** The board's rows, strongest implied value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, m: ModelConstants = MODEL): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const subjects = snapshot.protocols.filter((p) => isLaunchSubject(p) || watchlist.has(p.slug));
  const scored = subjects.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, m) }));
  scored.sort(
    (a, b) =>
      b.v.implied - a.v.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // The radar signal is the page's 0..100 heat, not the ranking: TVL depth, momentum, silence age,
  // chain breadth, and a bonus for the house's own watchlist membership.
  const byTvl = scored.map((s) => s.p.tvl_usd);
  return scored.map((s, i) => {
    const tvlPct = byTvl.filter((t) => t <= s.p.tvl_usd).length / byTvl.length;
    const growthScore = (Math.min(m.growth_cap, Math.max(m.growth_floor, finite(s.p.change_7d, 0))) - m.growth_floor) / (m.growth_cap - m.growth_floor);
    const ageScore = s.v.age === null ? 0.5 : Math.min(s.v.age, m.anticipation_days) / m.anticipation_days;
    const breadthScore = Math.min(s.p.chains.length, m.breadth_cap) / m.breadth_cap;
    const watchBonus = watchlist.has(s.p.slug) ? 1 : 0.3;
    const signal = Math.round(100 * (0.3 * tvlPct + 0.2 * growthScore + 0.3 * ageScore + 0.1 * breadthScore + 0.1 * watchBonus));
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: null,
      listed_at: s.p.listed_at,
      gecko_id: null,
      symbol: null,
      token_status: 'pre-token' as const,
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      on_watchlist: watchlist.has(s.p.slug),
      signal,
      model: {
        base_multiple: m.base_multiple,
        size_multiple: s.v.sizeMult,
        growth_pct: s.v.growthPct,
        growth_multiplier: s.v.growthMult,
        anticipation_multiplier: s.v.anticipationMult,
        breadth_multiplier: s.v.breadthMult,
      },
      farm_steps: farmSteps(s.p, s.v.age),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    on_watchlist: row.on_watchlist,
    signal: row.signal,
    size_multiple: row.model.size_multiple,
    growth_multiplier: row.model.growth_multiplier,
    anticipation_multiplier: row.model.anticipation_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, m: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, m);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const multiples = board.map((r) => r.implied_value_usd / Math.max(r.tvl_usd, 1)).sort((a, b) => a - b);
  const medianMultiple = multiples.length > 0 ? multiples[Math.floor(multiples.length / 2)]! : 0;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: m,
    model_version: MODEL_VERSION,
    watchlist_size: watchlist.size,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    median_multiple: Math.round(medianMultiple * 100) / 100,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, and the farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  if (board.length < 100 || board.length > 4_000) return `the board holds ${board.length} rows, the gate takes 100 to 4000`;
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
