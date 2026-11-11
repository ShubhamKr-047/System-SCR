# System SCR

System SCR is a chess game review extension for Chrome, Zen Browser, and Firefox. Review imported PGNs with a bundled Stockfish 19 engine, explore variations, and optionally request move explanations from Gemini or Groq.

Stockfish runs locally in a single-threaded WebAssembly worker. An AI API key is optional and never determines move classifications.

## Features

- PGN file and text import, plus a Chess.com **Analyze** launcher for public completed games.
- Quick, Balanced, and Deep whole-game reviews with selective critical-move verification.
- Eleven move classifications, evaluation graph, accuracy, estimated performance ratings, and classification explanations.
- Interactive board with animated moves, legal move hints, drag-and-drop, promotion selection, and nested variations.
- Navigation, autoplay, engine continuation previews, board flipping, and colored planning arrows and circles.
- Menu switches for the best-move arrow, evaluation bar, move classification badges, and AI Coach.
- Resizable sidebar, rook branding, and bundled fonts: Space Grotesk for headings, Inter for UI, and JetBrains Mono for numerical data.

**Analyze availability:** On numbered game pages, the launcher waits for Chess.com metadata to confirm that the matching game has finished. It checks about every five seconds while the tab is visible, backs off on failures, and stops after completion. Live end-of-game timing still needs manual verification; manual PGN import remains available.

## Build and install

Use Node.js 22.20+ and npm:

```powershell
git clone https://github.com/ShubhamKr-047/System-SCR.git
cd System-SCR
npm ci
npm run build
```

The build copies Stockfish's JavaScript/WASM files from the installed npm package and generates the extension in `dist/`.

1. In Zen or Firefox, open `about:debugging`.
2. Select **This Firefox > Load Temporary Add-on**.
3. Select `dist/manifest.json`.
4. Open the rook extension icon and select **Open System SCR**.

The manifest requires Firefox 128 or later. Temporary add-ons may be removed when the browser restarts. Permanent installation generally requires a signed Firefox add-on package; this build does not sign one.

After code changes, rebuild, reload the extension in `about:debugging`, and reload Chess.com tabs and the review page.

For Chrome/Chromium 121 or later, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the `dist/` folder. After rebuilding, click **Reload** on System SCR and refresh Chess.com tabs. The shared manifest uses a service worker in Chromium and background scripts in Firefox.

For review-page development without installing the extension:

```powershell
npm run dev
```

Open the local URL printed by Vite with `/review.html` appended. Extension-only behavior, including the Chess.com launcher, requires an installed extension.

## Review a game

1. Open System SCR from the extension popup.
2. Import a `.pgn` file or paste the full game on the empty-board screen. Import controls also remain available in the hamburger menu.
3. For **Menu > Paste PGN**, enter the moves in the panel beside the menu and select **Load**, or press Ctrl/Cmd + Enter.
4. Choose **Quick**, **Balanced**, or **Deep** under **Menu > Speed**.
5. Start **Review** in **Game Summary**.

Accuracy and estimated performance ratings remain hidden until the full review completes. Rating estimates describe this game's performance; they are not official ratings or predictions of actual playing strength.

Stop/resume preserves completed analysis within the current session. Repeating a completed review at the same quality reuses compatible results; selecting a higher quality can trigger additional analysis. Loading another PGN or reloading the page clears the current game and variations.

### Chess.com import

The rook **Analyze** button requests game metadata, finds the exact completed game in the player's public monthly archive, and opens its PGN in System SCR. `/game/<id>`, numbered live/daily game and analysis URLs are recognized; the content script also attempts to detect completed games on Chess.com's play pages.

Import requires a publicly archived completed game. Archive publication can lag behind the result, so a visible button does not guarantee immediate import. The callback endpoint used for metadata is undocumented and can change.

If the button is missing, try opening the completed game from your profile. If detection or retrieval still fails, download the PGN from Chess.com's Share/PGN controls and import it manually. Immediate post-game detection and archive availability are not guaranteed.

## Review speed and engine searches

| Menu mode | Whole-game target | Depth targets: initial / alternatives / verification |
| --- | --- | --- |
| Quick | 45 seconds | 14 / 17 / 18 |
| Balanced | 60 seconds | 16 / 19 / 20 |
| Deep | 90 seconds | 18 / 21 / 22 |

Older design documents call Balanced **Thorough**. The UI now calls it Balanced; the underlying middle review policy is the same.

These are adaptive targets, not fixed delays or guaranteed deadlines. Short games and cached reviews can finish sooner. Long games, engine startup, hardware, and CPU load can increase runtime. Searches may finish below their target depth when their time expires.

Ordinary searches use one principal variation. Alternative comparisons use two; a played move outside those lines receives a restricted search. Critical candidates receive additional checks within the shared game budget. The bundled engine uses one worker and cannot be made multithreaded through a setting.

Quick has less verification time and can differ from deeper modes on subtle or long combinations. Incomplete exceptional-move evidence falls back to a supported ordinary label. A completed progress bar means the workflow finished; it does not mean every tactical possibility was exhaustively proved.

## Move classifications

| Label | Basis |
| --- | --- |
| Brilliant | A near-best piece sacrifice with verified compensation or a qualifying mating continuation. Ordinary exchanges and immediate routine recaptures do not suffice. |
| Great | A verified critical resource with a significant gap to a reliably searched strongest alternative. |
| Best | The engine's top choice within tolerance, a close equivalent, or a move preserving a forced win by mate. |
| Excellent / Good | Small losses in estimated winning chances. |
| Book | A qualifying position-and-move match in the bundled opening index. |
| Forced | Exactly one legal move; excluded from accuracy calculations. |
| Inaccuracy / Mistake / Blunder | Increasing loss of estimated winning chances, with explicit mate-transition handling. |
| Miss | A verified missed opportunity created by the opponent's preceding error, measured from each player's correct perspective. |

Classification reasons are available on move badges and feedback headings. Brilliant precedes Great when its evidence is established. Miss requires verified historical evidence; simply losing an advantage is insufficient.

See [classification v5](docs/classification-v5.md) for current rules. Earlier documents provide context and provenance: [v4 mating-sacrifice changes](docs/mating-sacrifices-v4.md), [v3 architecture](docs/review-v3.md), and [original classification reference](docs/move-classification.md). Later versions supersede conflicting earlier rules and timing tables.

These are SCR's heuristics, not Chess.com's proprietary classifier. Bounded searches and sacrifice checks can miss unusual or long tactics. Regression fixtures protect known examples; they do not establish universal accuracy or agreement with every human annotation. The opening index is bundled locally from the CC0 Lichess opening dataset and supports transpositions.

## Board controls and variations

Click a piece and destination, or drag it to a legal square. Illegal drops cancel the move. Promotion offers queen, rook, bishop, and knight. **Menu > Analysis Board** starts a fresh board for independent study.

Playing an alternative from an imported position creates a variation. Continue the line, select moves in the indented move list, or create nested branches. **Back to game** returns to the original position where the variation began; **Parent branch** returns to a nested fork. Summary statistics stay attached to the original game. Moving pieces during a full-game review stops that review.

| Control | Action |
| --- | --- |
| Left / Right | Previous / next move in the selected line |
| Up / Down | Imported game's initial position / selected line's end |
| F | Flip the board |
| Playback buttons | Start, previous, play/pause, next, end |
| Escape | Cancel active drawing or dragging, or leave an engine preview |

Autoplay follows the original game. When started from a variation, it starts the original game from the beginning. Manual navigation and board interaction stop playback.

**Show Move** previews the engine's recommended continuation from before the reviewed move. **Back to move** or Escape restores the selected position. Previewing does not create variations or request AI explanations.

### Planning annotations and display

Right-drag between squares to draw an arrow; right-click a square to add a circle. Repeat the same annotation to remove it.

| Modifier | Color |
| --- | --- |
| None | Orange |
| Ctrl | Red |
| Alt or Meta | Blue |
| Shift | Green |
| Ctrl + Alt | Yellow |

Annotations survive board flips and engine updates. Left-clicking, making a move, navigating, or importing another game clears them. Classification badges render above engine and custom arrows. The classification switch controls board badges; analysis and summary classifications remain available.

The best-move arrow switch affects the engine suggestion independently of custom annotations. Evaluation bar visibility has its own switch.

Drag the divider above **Moves / Game Summary** to resize the sidebar sections. Focus it and use Up/Down or Home/End for keyboard adjustment; double-click to restore the automatic split. The chosen split is remembered.

## Optional AI Coach

Local Stockfish analysis and feedback work without an API key. To request additional explanations:

1. Enable **Menu > AI Coach** and select Gemini or Groq.
2. Create a key in [Google AI Studio](https://aistudio.google.com/app/apikey) or [Groq Console](https://console.groq.com/keys).
3. Paste the selected provider's key and select **Save**.
4. Select an eligible analyzed move and choose **Ask AI**.

Requests are manual. Saving a key, navigating, or flipping the board does not automatically request an explanation. Book and forced moves retain local feedback. Previously requested explanations can be reused from the in-memory cache; **Retry AI** retries a failed request.

Keys are stored separately in the browser profile. Switching providers retains both keys; clearing a key removes only the selected provider's key. Connection status distinguishes a saved key from a successful request. Local feedback remains available if a provider fails, and engine continuations stay independent of AI output.

The adapters are configured for `gemini-3.8-flash` and `openai/gpt-oss-120b`. These are repository configuration values, not guarantees of account access or model availability. Provider access, pricing, and quotas apply. AI explanations can contain errors and do not change engine scores or labels.

## Privacy and permissions

PGN analysis runs in the browser. Manual review requires no server or AI account. Building initially downloads npm dependencies; the engine, opening index, fonts, pieces, and sounds are then packaged locally.

| Permission or host access | Purpose |
| --- | --- |
| `storage` | Transfer imported Chess.com PGNs to the review page. |
| `tabs` | Open the review page. |
| `www.chess.com` | Inject the Analyze launcher and fetch game metadata. |
| `api.chess.com` | Retrieve public completed-game archives. |
| Google Gemini / Groq API hosts | Send an explicitly requested explanation to the selected provider. |

AI requests include the selected position, played move, board facts, and engine evidence. Player names and the full PGN are not included. Gemini keys are sent to Google; Groq keys are sent to Groq. No automatic provider fallback is used. Keys and UI preferences use browser-local storage; explanation caches and variation analysis are session-local.

Use System SCR for completed-game review and independent study. Do not use engine assistance during an ongoing competitive game.

## Development and verification

```powershell
# Unit tests
npm test

# Production extension build
npm run build

# Install browser runtimes once, then build and run browser tests
npx playwright install chromium firefox
npm run test:browser

# Focused launcher tests after a build
npx playwright test tests/browser/chesscom-launcher.spec.js
```

Browser tests run in Chromium and Firefox against the generated review page. They cover board interaction, menus, animations, variations, playback, classification, and progress. An additional Chromium test loads the built extension and checks background messaging, PGN transfer, and opening the review using controlled game responses. Firefox launcher tests use mocked extension APIs; they do not install a Firefox add-on.

Launcher tests use synthetic Chess.com DOM fixtures and mocked extension messages. They do not verify live Chess.com markup or immediate post-game behavior.

Optional coaching tests require Postman CLI 1.75+ and local simulations without real API keys:

```powershell
npm run test:coaching
```

See [simulation setup and coverage](postman/README.md). These checks establish client behavior against fixtures, not live provider access or explanation quality.

Engine benchmark commands:

```powershell
node scripts/benchmark-mating-sacrifices.mjs
node scripts/benchmark-classifications.mjs --compare
node scripts/benchmark-review.mjs --time=125
node scripts/benchmark-review.mjs --time=500
node scripts/benchmark-review.mjs --time=1000
```

Reports are written under the ignored `logs/` directory. Results depend on the machine and fixture corpus.

### Repository layout

| Path | Contents |
| --- | --- |
| `src/` | UI, board interaction, engine queue, classification, scheduling, and coaching |
| `content.js` / `background.js` | Chess.com launcher and completed-game retrieval |
| `manifest.json` | Firefox/Zen extension configuration |
| `public/` | Branding, pieces, fonts, sounds, and generated engine assets |
| `scripts/` | Engine copying, opening-data generation, and benchmarks |
| `tests/` | Unit tests, browser tests, and chess fixtures |
| `docs/` | Versioned classification design and validation notes |
| `postman/` | Local coaching simulations |
| `dist/` | Generated extension; not committed |

## Troubleshooting

| Problem | What to check |
| --- | --- |
| No Analyze button after a game | Keep the tab visible for the completion check. If metadata is unavailable, open the completed game from your profile or import its PGN manually. |
| Game not found in archive | Confirm it is public and completed; retry later or import the PGN. |
| Changes do not appear | Rebuild, reload the extension, then reload Chess.com and the review page. |
| Stockfish files missing | Run `npm ci` and rebuild; check `scripts/copy-engine.mjs` against the installed package layout. |
| Engine cannot start | Confirm `dist/engine/` contains `stockfish-19-lite-single.js` and `.wasm`, then reload. |
| PGN cannot load | Import complete PGN move text, preferably exported from the game's site. |
| Review takes too long | Choose Quick, reduce competing CPU load, or stop and resume. Targets are not hard deadlines. |
| Accuracy or rating hidden | Wait for full review completion. |
| AI explanation fails | Check provider, key, model access, and quota; local analysis remains available. |
| Extension disappears on restart | Reload the temporary add-on; permanent installation requires an appropriate signed package. |

## Third-party assets and licensing

Stockfish is GPL-licensed. The build includes upstream `Copying.txt`; preserve it and meet upstream license obligations, including applicable source requirements, when redistributing engine builds.

The opening dataset comes from [Lichess chess openings](https://github.com/lichess-org/chess-openings), published under CC0. Font license notices are bundled in `public/fonts/`. Review relevant upstream licenses before redistributing third-party assets.
