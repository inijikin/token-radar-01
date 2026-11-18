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
on TVL — trimmed to the 111 that are not extreme-ratio outliers, and weighted by the
snapshot's own launch odds by age and kind:

```
implied = launch odds × 477.6 × TVL_adj^0.5688 × category
TVL_adj = TVL ÷ (1 + clamp(change_7d, −50%, +50%) ÷ 100)
```

- **n = 111 fitted (17 trimmed), R² = 0.43, slope t = +9.0, residual SD 1.38.** The
  relation is real but noisy: the model ranks protocols, it does not predict a price.
  The 17 trimmed protocols sit more than 3 log-points from the line — their market cap
  per family TVL is twenty times the fitted value or a twentieth of it — and the slope
  barely moves when they are cut (0.55 to 0.57), which is the check the power law is not
  an artifact of the extremes.
- **The TVL in the fit is family TVL.** The snapshot records a token's market cap on one
  deployment row while its TVL is split across sibling rows sharing the symbol, so the
  fit pairs each token's market cap with its family's total growth-adjusted TVL. Out of
  sample (repeated 5-fold CV) the family fit beats the one-deployment fit in every repeat.
  Board rows are valued on their own TVL, so a protocol that is one deployment of a larger
  family is valued conservatively.
- **Elasticity 0.57, strongly sub-linear.** The market values the first dollars of TVL far
  more than the marginal billion; a protocol ten times larger fetches about 3.7 times the
  value, not ten times.
- **Launch odds come from the snapshot's own tokenization rate by age** among the protocols
  that would be rankable were they tokenless (shrunk k = 20 toward the 50% average, joined
  in log age between the band medians): 31% under six months, 40% at six months to two
  years, 60% at two to three years, 79% past three years — times a category factor for
  what age alone cannot explain (shrunk k = 10 toward 1): Risk Curators 0.60 (only 5 of 39
  have a token), Lending 1.19, Basis Trading 1.19. A logistic fit was tried and rejected:
  it predicts 18% for a 30-day protocol while the snapshot's own youngest band records
  30%, and it loses out of sample.
- **Momentum is not a multiplier.** Its linear coefficient (−3.71, t = −1.6) is unstable
  across split halves, so momentum only trims the TVL input through the clamp above.
- **Age is not a fitted factor on value either** (coefficient −0.116, t = −0.4). It enters
  only through launch odds: older protocols without a token are more likely to launch,
  not worth more.
- **Category multipliers** are shrunk deviations of value per growth-adjusted TVL (k = 20,
  capped 0.7–1.4), recomputed on the trimmed set; a category with no fitted member gets
  1.000. Joint category dummies inside the regression were tried and failed (every dummy
  |t| ≤ 1.5).

The board ranks all 198 rankable pre-token protocols — the 40 watchlist slugs plus the
rest the watchlist's own rule keeps — by implied value. The top of the board on the
2026-11-14 snapshot: Steakhouse Financial ($34.0M), Sentora Curator ($29.4M), Veda
($25.9M), Polymarket International ($24.4M), USDD ($23.9M). Total implied value $1.00B.

## Farm plans

Every row carries seven concrete steps built from that protocol's own chains, category and
TVL: a fresh wallet for the protocol's chain (Phantom for Solana, MetaMask or Rabby for EVM
chains, and so on), the main action with capital and gas, a weekly qualifying action, a
hold period with the reason for that kind of protocol, a multi-chain note where it applies,
how to claim safely, and a log naming the position's own records. Capital tiers run
$50–$250 by TVL; gas is priced per chain (Ethereum ~$12, most L2s and Solana under $1).
559 of the 1,386 steps are distinct; the rest repeat only where the protocol genuinely
shares a chain, a category and a size with another row.

## The dashboard

`dashboard/` is a fully offline page (no network addresses anywhere): a sortable,
filterable board with a watchlist-only toggle, a live-token view set aside from the farm
board, a detail view for every protocol that shows the implied value step by step and
recomputes it in the page, and a model panel with the fit's scatter plot — the 111 fitted
protocols as amber dots, the 17 trimmed outliers as grey dots, the fitted line through
them.

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
screenshots/              board, detail view, filtered view, model view
```

## License

MIT. See LICENSE.
