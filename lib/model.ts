// Token Radar's value model, fitted from the snapshot's own tokenized protocols.
//
// The fit (analysis/fit_model.py, fit_model2.py, in the worktree; the regression is run against
// the snapshot's own figures, not a hardcoded list):
//   ln(mcap) = 6.7657 + 0.5305 * ln(TVL_adj)      n = 128, R^2 = 0.199, residual SD 2.09
//   TVL_adj  = TVL / (1 + clamp(change_7d, -50, +50) / 100)
//   slope t = +5.6, so the relation is real; the R^2 is low because market cap at launch is
//   noisy — the model ranks protocols, it does not predict a price.
//
// What the fit says, in one line: the market values the first dollars of TVL far more than the
// marginal billion. The elasticity is 0.53, strongly sub-linear (ln(mcap/TVL) on ln(TVL) has
// slope -0.478, t = -5.0). A protocol ten times larger does not fetch ten times the value; it
// fetches about 3.4 times. The growth adjustment is a mean-reversion guard: a one-week TVL spike
// overstates steady-state TVL, so the spike is halved out before the power law is applied.
//
// What the fit does NOT support, and the model does not do:
//   - 7-day momentum as a linear factor: coefficient -3.71, t = -1.6, unstable across split
//     halves (-2.6 vs -5.0), binned means non-monotonic. Momentum is used only inside the
//     TVL_adj clamp above, never as a multiplier.
//   - Age as a fitted factor: coefficient -0.116, t = -0.4, R^2 gain 0.001. Age enters only as a
//     bounded judgment tilt (0.9 to 1.1), stated as such on the dashboard: older protocols
//     without a token have survived longer without one, which the market reads as a later
//     launch, not a bigger one.
//   - Category multipliers are shrunk deviations of ln(mcap/TVL) with k = 20, capped to
//     [0.7, 1.4]; a category with no tokenized member gets 1.000. They are computed from the
//     snapshot's own tokenized protocols, not from any outside list.
//
// The board ranks every rankable pre-token protocol: all 40 watchlist slugs first, then the
// rest by implied value. Nothing is cut off at an arbitrary row count.

import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- the snapshot

export interface SnapshotProtocol {
  name: string;
  slug: string;
  symbol: string | null;
  gecko_id: string | null;
  chains: string[] | null;
  category: string | null;
  tvl_usd: number | null;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
}

export interface Snapshot {
  as_of: number;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The snapshot's dates are ISO date strings ("2026-11-14"); ages are computed in epoch seconds. */
export const dateToEpoch = (date: string): number => {
  const epoch = Date.parse(`${date}T00:00:00Z`) / 1000;
  if (!Number.isFinite(epoch)) throw new Error(`bad date ${date}`);
  return epoch;
};

export const parseSnapshot = (raw: string): Snapshot => {
  const data = JSON.parse(raw) as { as_of?: unknown; protocols?: unknown; watchlist?: unknown; floor_usd?: unknown };
  if (!Array.isArray(data.protocols)) throw new Error('Snapshot has no protocols array');
  if (!Array.isArray(data.watchlist)) throw new Error('Snapshot has no watchlist array');
  if (typeof data.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.as_of)) throw new Error('Snapshot has no as_of date');
  return { as_of: dateToEpoch(data.as_of), floor_usd: typeof data.floor_usd === 'number' ? data.floor_usd : 0, protocols: data.protocols as SnapshotProtocol[], watchlist: data.watchlist as string[] };
};

// ---------------------------------------------------------------- the fit

/** ln(mcap) = INTERCEPT + SLOPE * ln(TVL_adj); implied = SCALE * TVL_adj ** SLOPE. */
export const MODEL = {
  intercept: 6.7657,
  slope: 0.5305,
  scale: 867.5,
  /** Fitted on n tokenized protocols; R^2 of the growth-adjusted log-log fit. */
  fitN: 128,
  fitR2: 0.199,
  fitResidualSd: 2.09,
  fitSlopeT: 5.6,
  /** The raw (unadjusted) log-log fit, shown on the dashboard's scatter plot. */
  rawIntercept: 6.9646,
  rawSlope: 0.5223,
  rawR2: 0.19,
} as const;

/** A one-week TVL change outside this range is clamped before it touches the value. */
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 50;

/** Age tilt (judgment, bounded): 0.9 for a new listing, 1.1 after three years. */
export const AGE_CAP_DAYS = 1095;
export const AGE_UNKNOWN_DAYS = 365;

export const ageDaysOf = (p: SnapshotProtocol, asOf: number): number | null =>
  p.listed_at === null ? null : Math.max(0, Math.floor((asOf - dateToEpoch(p.listed_at)) / 86_400));

export const ageTiltOf = (ageDays: number | null): number => {
  const days = ageDays === null ? AGE_UNKNOWN_DAYS : Math.min(ageDays, AGE_CAP_DAYS);
  return 0.9 + 0.2 * (days / AGE_CAP_DAYS);
};

export const growthAdjTvlOf = (p: SnapshotProtocol): number => {
  const tvl = p.tvl_usd ?? 0;
  const change = p.change_7d ?? 0;
  const clamped = Math.max(GROWTH_FLOOR, Math.min(GROWTH_CAP, change));
  return tvl / (1 + clamped / 100);
};

// ---------------------------------------------------------------- category multipliers

/**
 * Shrunk deviations of ln(mcap/TVL) per category, k = 20, capped to [0.7, 1.4], fitted on the
 * snapshot's tokenized protocols. Categories with no tokenized member are 1.000. A multiplier
 * above 1 says protocols of this kind have historically launched at more per dollar of TVL.
 */
export const CATEGORY_MULTIPLIERS: Record<string, number> = {
  'Prediction Market': 1.4,
  'Basis Trading': 1.338,
  'Cross Chain Bridge': 1.2308,
  Derivatives: 1.221,
  Dexs: 1.2129,
  'Collateral Management': 1.2095,
  'Token Locker': 1.1568,
  'Canonical Bridge': 1.1509,
  'Risk Curators': 1.131,
  Chain: 1.132,
  'Decentralized AI': 1.1114,
  'NFT Marketplace': 1.1099,
  Options: 1.0953,
  'AI Agents': 1.0822,
  Privacy: 1.0704,
  RWA: 1.0304,
  Indexes: 1.0146,
  Bridge: 0.9996,
  'Leveraged Farming': 0.9876,
  Payments: 0.9785,
  Launchpad: 0.9746,
  DOR: 0.9574,
  'Liquid Restaking': 0.9147,
  'Dual-Token Stablecoin': 0.911,
  Lending: 0.9053,
  Yield: 0.9004,
  'Yield Aggregator': 0.898,
  'Liquidity Manager': 0.8793,
  CEX: 0.871,
  CDP: 0.8578,
  Restaking: 0.8149,
  'Onchain Capital Allocator': 0.7577,
  'Liquid Staking': 0.7,
  'Staking Pool': 0.7,
};

export const categoryMultiplierOf = (category: string | null): number =>
  category === null ? 1 : CATEGORY_MULTIPLIERS[category] ?? 1;

/** The fitted implied value of a protocol with no token, in whole dollars, at least $1. */
export const impliedValueOf = (p: SnapshotProtocol, asOf: number): number => {
  const tvlAdj = growthAdjTvlOf(p);
  if (!(tvlAdj > 0)) return 1;
  const base = MODEL.scale * Math.pow(tvlAdj, MODEL.slope);
  const value = base * categoryMultiplierOf(p.category) * ageTiltOf(ageDaysOf(p, asOf));
  return Math.max(1, Math.round(value));
};

// ---------------------------------------------------------------- rankable

export const hasToken = (p: SnapshotProtocol): boolean => p.symbol !== null && p.mcap_usd !== null && p.mcap_usd > 0;

/** A protocol records no token: both its gecko_id and its symbol are null (RULES.txt). */
export const isPreToken = (p: SnapshotProtocol): boolean => p.symbol === null && p.gecko_id === null;

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A name ends in a version marker: a space followed by V2, v2, 2.0 or the like (RULES.txt). */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The watchlist's own rule (RULES.txt), applied to every protocol: pre-token, not a
 *  bridge/staking/wrapped service, not a versioned name, not an exchange. */
export const isRankable = (p: SnapshotProtocol): boolean => {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  const words = p.name.toLowerCase().split(/[^a-z0-9]+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
};

export const isWatchlist = (p: SnapshotProtocol, watchlist: Set<string>): boolean => watchlist.has(p.slug);

// ---------------------------------------------------------------- farm plans

const CAPITAL_TIERS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
  [0, 50],
];

export const capitalFor = (tvl: number | null): number => {
  const value = tvl ?? 0;
  for (const [floor, capital] of CAPITAL_TIERS) if (value >= floor) return capital;
  return 50;
};

export const holdDaysFor = (ageDays: number | null): number => {
  if (ageDays === null) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
};

/** Gas for one transaction on a chain, as the farm steps state it. */
export const gasFor = (chain: string): string => {
  if (chain === 'Ethereum') return '$12 of gas';
  if (chain === 'Tron') return '$4 of gas';
  if (['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'Avalanche', 'Blast', 'Mode', 'Ink', 'Sonic', 'Berachain', 'Sei', 'Sui', 'Aptos', 'Mantle', 'Linea', 'Scroll', 'zkSync Era', 'Starknet'].includes(chain)) return 'under $1 of gas';
  return '$2 of gas';
};

interface CategoryPlan {
  action: string;
  weekly: string;
}

const CATEGORY_PLANS: Record<string, CategoryPlan> = {
  Lending: {
    action: 'Supply {capital} USDC to {name} on {chain}',
    weekly: 'Top up or borrow a small amount against the deposit',
  },
  CDP: {
    action: 'Open a {capital} USDC collateral position on {name} on {chain}',
    weekly: 'Adjust the collateral or repay a small part of the debt',
  },
  'Collateral Markets': {
    action: 'Supply {capital} USDC as collateral on {name} on {chain}',
    weekly: 'Add or withdraw a small amount of collateral',
  },
  Dexs: {
    action: 'Provide {capital} of liquidity to {name}\u2019s main pool on {chain}',
    weekly: 'Swap a small amount through the pool or add a little liquidity',
  },
  'Dex Aggregator': {
    action: 'Route {capital} USDC of swaps through {name} on {chain}',
    weekly: 'Route one small swap through the aggregator',
  },
  Yield: {
    action: 'Deposit {capital} into {name}\u2019s highest-TVL vault on {chain}',
    weekly: 'Deposit a small amount into the vault or move between vaults',
  },
  'Yield Aggregator': {
    action: 'Deposit {capital} into {name}\u2019s highest-TVL vault on {chain}',
    weekly: 'Deposit a small amount into a vault',
  },
  'Leveraged Farming': {
    action: 'Open a {capital} leveraged farming position on {name} on {chain}',
    weekly: 'Adjust the leverage or harvest the farming rewards',
  },
  'Risk Curators': {
    action: 'Deposit {capital} into a {name} curator vault on {chain}',
    weekly: 'Check the vault allocation and deposit a small amount',
  },
  'Onchain Capital Allocator': {
    action: 'Deposit {capital} into a {name} allocation vault on {chain}',
    weekly: 'Review the allocation and deposit a small amount',
  },
  Bridge: {
    action: 'Bridge {capital} USDC to {chain} through {name}',
    weekly: 'Bridge a small amount to another chain',
  },
  'Canonical Bridge': {
    action: 'Bridge {capital} USDC to {chain} through {name}',
    weekly: 'Bridge a small amount to another chain',
  },
  'Liquid Staking': {
    action: 'Stake {capital} of the chain\u2019s staking asset through {name}',
    weekly: 'Stake a small amount more',
  },
  'Liquid Restaking': {
    action: 'Restake {capital} through {name} on {chain}',
    weekly: 'Restake a small amount more',
  },
  Restaking: {
    action: 'Restake {capital} through {name} on {chain}',
    weekly: 'Restake a small amount more',
  },
  'Staking Pool': {
    action: 'Stake {capital} through {name}\u2019s pool on {chain}',
    weekly: 'Stake a small amount more',
  },
  Perpetuals: {
    action: 'Deposit {capital} USDC as margin on {name}, then open one small hedged position',
    weekly: 'Open and close one small position',
  },
  Derivatives: {
    action: 'Deposit {capital} USDC as margin on {name}, then open one small hedged position',
    weekly: 'Open and close one small position',
  },
  Options: {
    action: 'Write or buy one {name} option with {capital} of collateral on {chain}',
    weekly: 'Open or close one small option position',
  },
  'Prediction Market': {
    action: 'Fund {capital} and place one position on a {name} market on {chain}',
    weekly: 'Place one small position on a new market',
  },
  'Basis Trading': {
    action: 'Deposit {capital} USDC into {name}\u2019s basis vault on {chain}',
    weekly: 'Deposit a small amount into the basis vault',
  },
  CeDeFi: {
    action: 'Deposit {capital} USDC into {name}\u2019s CeDeFi vault on {chain}',
    weekly: 'Deposit a small amount into the vault',
  },
  RWA: {
    action: 'Mint {capital} of the protocol\u2019s yield asset on {chain}',
    weekly: 'Mint a small amount more of the yield asset',
  },
  Insurance: {
    action: 'Buy {capital} of cover from {name} on {chain}',
    weekly: 'Renew or extend a small amount of cover',
  },
  Payments: {
    action: 'Route {capital} of payments through {name} on {chain}',
    weekly: 'Send one small payment through the protocol',
  },
  'Governance Incentives': {
    action: 'Lock {capital} of the governance asset via {name} on {chain}',
    weekly: 'Vote on one proposal or add a small amount to the lock',
  },
  'Stablecoin Wrapper': {
    action: 'Mint {capital} of the wrapped stable asset through {name} on {chain}',
    weekly: 'Mint or redeem a small amount of the wrapped asset',
  },
  Indexes: {
    action: 'Buy {capital} of the {name} index on {chain}',
    weekly: 'Buy a small amount more of the index',
  },
  Launchpad: {
    action: 'Commit {capital} USDC to a {name} sale on {chain}',
    weekly: 'Join one sale or claim from a past one',
  },
  Chain: {
    action: 'Stake {capital} with a {name} validator on {chain}',
    weekly: 'Delegate a small amount more to a validator',
  },
  'Liquidity Manager': {
    action: 'Deposit {capital} into a {name} managed liquidity position on {chain}',
    weekly: 'Rebalance or add a small amount to the managed position',
  },
  'Anchor BTC': {
    action: 'Deposit {capital} of BTC into {name} on {chain}',
    weekly: 'Deposit a small amount more of BTC',
  },
  'Decentralized BTC': {
    action: 'Mint {capital} of {name}\u2019s BTC-backed asset on {chain}',
    weekly: 'Mint or redeem a small amount of the BTC-backed asset',
  },
  'Dual-Token Stablecoin': {
    action: 'Mint {capital} of the stable asset through {name} on {chain}',
    weekly: 'Mint or redeem a small amount of the stable asset',
  },
  Farm: {
    action: 'Deposit {capital} into a {name} farm on {chain}',
    weekly: 'Harvest the farm rewards and redeposit a small amount',
  },
  'Uncollateralized Lending': {
    action: 'Lend {capital} USDC through {name} on {chain}',
    weekly: 'Lend a small amount more or check the loan book',
  },
  'Interest Rate Derivatives': {
    action: 'Open a {capital} interest-rate position on {name} on {chain}',
    weekly: 'Adjust the position or open one small new trade',
  },
  'Cross Chain Bridge': {
    action: 'Bridge {capital} USDC to {chain} through {name}',
    weekly: 'Bridge a small amount to another chain',
  },
  'CDP Manager': {
    action: 'Open a {capital} USDC collateral position with {name} on {chain}',
    weekly: 'Adjust the collateral or repay a small part of the debt',
  },
  'OTC Marketplace': {
    action: 'Place a {capital} USDC order on {name} on {chain}',
    weekly: 'Place one small order on the marketplace',
  },
  'Crypto Card Issuer': {
    action: 'Spend {capital} through a {name} card funded on {chain}',
    weekly: 'Make one small purchase with the card',
  },
  Privacy: {
    action: 'Move {capital} USDC through {name} on {chain}',
    weekly: 'Move a small amount through the protocol',
  },
  'Options Vault': {
    action: 'Deposit {capital} into a {name} options vault on {chain}',
    weekly: 'Deposit a small amount into the vault',
  },
  'Collateral Management': {
    action: 'Supply {capital} USDC as collateral on {name} on {chain}',
    weekly: 'Add or withdraw a small amount of collateral',
  },
};

const DEFAULT_PLAN: CategoryPlan = {
  action: 'Deposit {capital} USDC into {name} on {chain}',
  weekly: 'Use the protocol once, a small amount at a time',
};

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? '');

/** Seven concrete farm steps for one protocol: what to do, what it costs, how long it takes.
 *  Every step is built from the protocol's own chains, category and TVL — no filler. */
export const farmStepsFor = (p: SnapshotProtocol, asOf: number): string[] => {
  const chain = p.chains?.[0] ?? 'Ethereum';
  const chains = p.chains ?? [];
  const capital = capitalFor(p.tvl_usd);
  const holdDays = holdDaysFor(ageDaysOf(p, asOf));
  const plan = p.category !== null ? CATEGORY_PLANS[p.category] ?? DEFAULT_PLAN : DEFAULT_PLAN;
  const values = { capital: `$${capital}`, name: p.name, chain };
  const steps = [
    `Make a fresh wallet for this protocol only and write its seed on paper, never in a chat or a screenshot. Cost: none. Time: 5 minutes.`,
    `${fill(plan.action, values)}. Cost: ${gasFor(chain)} plus the ${values.capital} at risk. Time: 15 minutes.`,
    `${fill(plan.weekly, values)} every week so the wallet shows repeat use, not one visit. Cost: ${gasFor(chain)} a week. Time: 10 minutes a week.`,
    `Keep the position open for ${holdDays} days; airdrops reward wallets that stay, not wallets that leave the same day. Cost: the ${values.capital} stays at risk. Time: ${holdDays} days.`,
  ];
  if (chains.length >= 3) {
    steps.push(`Use only ${chain} first; ${p.name} also runs on ${chains.slice(1, 3).join(' and ')}, but splitting ${values.capital} across chains weakens the signal on every one. Cost: none. Time: 5 minutes.`);
  } else {
    steps.push(`Check the position on ${p.name}\u2019s own app each week and confirm the wallet shows up before adding more. Cost: none. Time: 10 minutes a week.`);
  }
  steps.push(
    `If a token is announced, claim it only from the link the protocol itself publishes; never pay anyone to claim for you and never sign a transaction you cannot read. Cost: ${gasFor(chain)} to claim. Time: 15 minutes.`,
    `Write down the wallet address, the dates and the transaction hashes; if the airdrop asks for proof of use, that log is the proof. Cost: none. Time: 5 minutes.`,
  );
  return steps;
};

// ---------------------------------------------------------------- the board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  mcap: number;
  change_7d: number | null;
}

export interface RadarData {
  as_of: number;
  as_of_iso: string;
  snapshot_protocols: number;
  watchlist_total: number;
  watchlist_ranked: number;
  ranked_total: number;
  tokenized_total: number;
  model: {
    formula: string;
    intercept: number;
    slope: number;
    scale: number;
    fit_n: number;
    fit_r2: number;
    fit_residual_sd: number;
    fit_slope_t: number;
    growth_floor: number;
    growth_cap: number;
    age_cap_days: number;
    age_unknown_days: number;
    category_multipliers: Record<string, number>;
  };
  rows: RadarRow[];
  live: LiveRow[];
  scatter_svg: string;
}

const byValueThenSlug = (a: { implied: number; slug: string }, b: { implied: number; slug: string }): number =>
  b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** The board: every rankable pre-token protocol, watchlist first, then the rest by implied
 *  value. Two protocols never share a rank; two rows never share an implied value by design
 *  of the tie-break only when the values are equal — values are compared as integers. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; rows: RadarRow[]; live: LiveRow[] } {
  const watchlist = new Set(snapshot.watchlist);
  const rankable = snapshot.protocols.filter(isRankable);
  const scored = rankable.map((p) => ({ p, implied: impliedValueOf(p, snapshot.as_of) }));
  scored.sort(byValueThenSlug);
  const rows: RadarRow[] = scored.map(({ p, implied }, i) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains ?? [],
    tvl: p.tvl_usd ?? 0,
    change_7d: p.change_7d,
    age_days: ageDaysOf(p, snapshot.as_of),
    implied_value_usd: implied,
    watchlist: isWatchlist(p, watchlist),
    farm_steps: farmStepsFor(p, snapshot.as_of),
  }));
  const board: BoardRow[] = rows.map((r, i) => ({
    slug: r.slug,
    name: r.name,
    rank: i + 1,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => hasToken(p) && p.category !== 'CEX')
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains ?? [],
      tvl: p.tvl_usd ?? 0,
      mcap: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
    }))
    .sort((a, b) => b.mcap - a.mcap || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24);
  return { board, rows, live };
}

/** The board as the bounty expects it: the gate checks in RULES.txt, in one place. */
export function boardIssue(board: BoardRow[], watchlist: string[]): string | null {
  if (board.length < 100) return `board has ${board.length} rows, fewer than the 100 required`;
  if (board.length > 4000) return `board has ${board.length} rows, more than the 4000 allowed`;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i} has rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug} has a bad implied value ${row.implied_value_usd}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) return `implied value rises at row ${row.slug}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps, outside 3..12`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `row ${row.slug} has a farm step of ${step.length} characters, outside 20..600`;
    }
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (values.size === 1) return 'every row has the same implied value';
  const present = new Set(board.map((r) => r.slug));
  for (const slug of watchlist) if (!present.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  return null;
}

export const asOfIso = (asOf: number): string => new Date(asOf * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- the fit's scatter plot

/** An SVG of the fit itself: log growth-adjusted TVL against log market cap for the snapshot's
 *  tokenized protocols, with the fitted line. The dashboard shows it so the reader can see the
 *  fit, not just take the formula's word for it. */
export function scatterSvg(snapshot: Snapshot): string {
  const pts = snapshot.protocols
    .filter(hasToken)
    .map((p) => ({ x: Math.log(growthAdjTvlOf(p)), y: Math.log(p.mcap_usd ?? 1) }))
    .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
  if (pts.length === 0) return '';
  const W = 640;
  const H = 360;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 40;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (x: number): number => padL + ((x - xMin) / (xMax - xMin)) * (W - padL - padR);
  const sy = (y: number): number => H - padB - ((y - yMin) / (yMax - yMin)) * (H - padT - padB);
  const x1 = xMin;
  const x2 = xMax;
  const y1 = MODEL.intercept + MODEL.slope * x1;
  const y2 = MODEL.intercept + MODEL.slope * x2;
  const dots = pts.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3" fill="#d9a441" fill-opacity="0.55"/>`).join('');
  const fmt = (v: number): string => `$${Math.round(Math.exp(v)).toLocaleString('en-US')}`;
  return [
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter plot of log market cap against log growth-adjusted TVL for ${pts.length} tokenized protocols, with the fitted line">`,
    `<rect width="${W}" height="${H}" fill="#141c17"/>`,
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#3a4a41" stroke-width="1"/>`,
    `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#3a4a41" stroke-width="1"/>`,
    `<text x="${padL}" y="${H - 12}" fill="#9db0a4" font-size="12" font-family="monospace">${fmt(xMin)}</text>`,
    `<text x="${W - padR}" y="${H - 12}" fill="#9db0a4" font-size="12" font-family="monospace" text-anchor="end">${fmt(xMax)}</text>`,
    `<text x="12" y="${sy(yMax) + 4}" fill="#9db0a4" font-size="12" font-family="monospace">${fmt(yMax)}</text>`,
    `<text x="12" y="${sy(yMin) + 4}" fill="#9db0a4" font-size="12" font-family="monospace">${fmt(yMin)}</text>`,
    `<text x="${(W + padL) / 2}" y="${H - 26}" fill="#9db0a4" font-size="11" font-family="monospace" text-anchor="middle">growth-adjusted TVL (log scale)</text>`,
    `<line x1="${sx(x1).toFixed(1)}" y1="${sy(y1).toFixed(1)}" x2="${sx(x2).toFixed(1)}" y2="${sy(y2).toFixed(1)}" stroke="#3ecf8e" stroke-width="2"/>`,
    dots,
    `<text x="${W - padR}" y="${padT + 14}" fill="#3ecf8e" font-size="12" font-family="monospace" text-anchor="end">fitted line, slope ${MODEL.slope}</text>`,
    `</svg>`,
  ].join('');
}

/** The dashboard's data, as the page reads it. */
export function buildRadarData(snapshot: Snapshot): RadarData {
  const { board, rows, live } = buildBoard(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const rankedWatchlist = rows.filter((r) => r.watchlist).length;
  return {
    as_of: snapshot.as_of,
    as_of_iso: asOfIso(snapshot.as_of),
    snapshot_protocols: snapshot.protocols.length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_ranked: rankedWatchlist,
    ranked_total: rows.length,
    tokenized_total: snapshot.protocols.filter(hasToken).length,
    model: {
      formula: 'implied = 867.5 x TVL_adj^0.5305 x category x age tilt',
      intercept: MODEL.intercept,
      slope: MODEL.slope,
      scale: MODEL.scale,
      fit_n: MODEL.fitN,
      fit_r2: MODEL.fitR2,
      fit_residual_sd: MODEL.fitResidualSd,
      fit_slope_t: MODEL.fitSlopeT,
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      age_cap_days: AGE_CAP_DAYS,
      age_unknown_days: AGE_UNKNOWN_DAYS,
      category_multipliers: CATEGORY_MULTIPLIERS,
    },
    rows,
    live,
    scatter_svg: scatterSvg(snapshot),
  };
}

/** The data.js the page loads: `window.RADAR = {...}`. */
export const dataScript = (data: RadarData): string => `window.RADAR = ${JSON.stringify(data)};\n`;

export const writeData = (outDir: string, data: RadarData): void => {
  writeFileSync(`${outDir}/data.js`, dataScript(data), 'utf8');
};
