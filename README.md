# Token Radar

[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/inijikin/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/inijikin/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Which pre-token protocol is worth farming next, and what do you do about it?

Token Radar ranks every pre-token protocol in a sealed snapshot by a fitted launch value —
what the market has historically paid, per dollar of TVL, for protocols like it — and gives
each one a concrete farm plan with costs and time. It reads the snapshot's own figures, not
a hand-kept list of names, so the same program finds the next airdrop early instead of
waiting for someone to add it to a list.

Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun.

## The model

Fitted from the snapshot's own 128 tokenized protocols, log-log regression of market cap
on TVL:

```
implied = 867.5 × TVL_adj^0.5305 × category × age tilt
TVL_adj = TVL ÷ (1 + clamp(change_7d, −50%, +50%) ÷ 100)
```

- **n = 128, R² = 0.20, slope t = +5.6, residual SD 2.09.** The relation is real but noisy:
  the model ranks protocols, it does not predict a price.
- **Elasticity 0.53, strongly sub-linear.** The market values the first dollars of TVL far
  more than the marginal billion; a protocol ten times larger fetches about 3.4 times the
  value, not ten times.
- **Momentum is not a multiplier.** Its linear coefficient (−3.71, t = −1.6) is unstable
  across split halves, so momentum only trims the TVL input through the clamp above.
- **Age is not a fitted factor either** (coefficient −0.116, t = −0.4). It enters as a
  bounded judgment tilt of 0.9 to 1.1, stated as such on the dashboard.
- **Category multipliers** are shrunk deviations of value per TVL (k = 20, capped 0.7–1.4);
  a category with no tokenized member gets 1.000.

The board ranks all 198 rankable pre-token protocols — the 40 watchlist slugs plus the
rest the watchlist's own rule keeps — by implied value. The top of the board on the
2026-11-14 snapshot: Steakhouse Financial ($101.0M), Sentora Curator ($96.2M), Gauntlet
($72.2M), Veda ($52.7M), USDD ($46.8M).

## Farm plans

Every row carries seven concrete steps built from that protocol's own chains, category and
TVL: a fresh wallet, the main action with capital and gas, a weekly qualifying action, a
hold period, a multi-chain note where it applies, how to claim safely, and a log to keep.
Capital tiers run $50–$250 by TVL; gas is priced per chain (Ethereum ~$12, most L2s and
Solana under $1).

## The dashboard

`dashboard/` is a fully offline page (no network addresses anywhere): a sortable,
filterable board with a watchlist-only toggle, a live-token view set aside from the farm
board, a detail view for every protocol that shows the implied value step by step and
recomputes it in the page, and a model panel with the fit's scatter plot — the 128
tokenized protocols as dots, the fitted line through them.

## Run it

Node 22, standard library only, no network, deterministic — two runs produce
byte-identical output.

```sh
node main.ts /input/snapshot.json /output
```

Reads `/input/snapshot.json`, writes `/output/board.json` (198 rows), `/output/data.js`,
copies `dashboard/` and `screenshots/` to `/output`, and writes `/output/dossier.json`
with `buildDossier` from `vendor/makefun-board.ts`.

## Layout

```
main.ts                  entrypoint: snapshot in, board + data + dossier out
lib/model.ts             the fitted value model, the board, the farm plans
vendor/makefun-board.ts  make.fun's dossier library (house file, copied from the kit)
dashboard/               index.html, app.css, app.js — the offline page
screenshots/              board, detail view, filtered view
```

## License

MIT. See LICENSE.
