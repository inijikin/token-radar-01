// Token Radar: build the board, the dashboard data and the dossier.
//
//   node main.ts [snapshot.json] [out-dir]
//     snapshot.json defaults to /input/snapshot.json, out-dir to /output.
//     Run from the repository root so dashboard/ and screenshots/ are found.
//
// Deterministic: the same snapshot always produces the same bytes. No network, no clock,
// no randomness. The board is built by lib/model.ts (the fitted value model); this file only
// wires the input to the output and refuses to write a board that fails the bounty gate.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { boardIssue, buildBoard, buildRadarData, parseSnapshot, writeData } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const inputPath = process.argv[2] ?? '/input/snapshot.json';
const outDir = process.argv[3] ?? '/output';

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, rows, live } = buildBoard(snapshot);
const issue = boardIssue(board, snapshot.watchlist);
if (issue !== null) throw new Error(`board gate failed: ${issue}`);

const data = buildRadarData(snapshot);
const watchlistRanked = rows.filter((r) => r.watchlist).length;

mkdirSync(outDir, { recursive: true });
mkdirSync(`${outDir}/dashboard`, { recursive: true });
mkdirSync(`${outDir}/screenshots`, { recursive: true });

writeFileSync(`${outDir}/board.json`, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
writeData(outDir, data);
cpSync('dashboard', `${outDir}/dashboard`, { recursive: true });
cpSync('screenshots', `${outDir}/screenshots`, { recursive: true });

const shots = readdirSync(`${outDir}/screenshots`).filter((f) => !f.startsWith('.'));
if (shots.length < 3) throw new Error(`screenshots/ holds ${shots.length} images, need at least 3`);

const dossier = buildDossier(outDir, {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 10, max_bytes: 65536 },
});
writeFileSync(`${outDir}/dossier.json`, dossier);

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
console.log(`snapshot: ${snapshot.protocols.length} protocols, as of ${data.as_of_iso}`);
console.log(`board: ${board.length} rows, watchlist ${watchlistRanked}/${snapshot.watchlist.length}, live set aside ${live.length}`);
console.log(`top 5: ${board.slice(0, 5).map((r) => `${r.rank}. ${r.name} ${money(r.implied_value_usd)}`).join(' | ')}`);
console.log(`implied range: ${money(board[0]!.implied_value_usd)} down to ${money(board[board.length - 1]!.implied_value_usd)}`);
console.log(`board.json: ${outDir}/board.json, dossier.json: ${outDir}/dossier.json (${dossier.length} bytes)`);
console.log('board gate: PASS');
