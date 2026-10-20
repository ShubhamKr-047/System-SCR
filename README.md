# Zen Chess Review (starter MVP)

A free Firefox/Zen WebExtension starter for reviewing **completed** Chess.com games with a local Stockfish WebAssembly engine. It opens a separate review page. It does not read or analyze live games.

## What is included

- Separate review page with a board, move list, navigation, PGN import, and feedback panel.
- PGN import by file or pasted text.
- Local Stockfish integration (lite, single-threaded build) and adjustable per-position time.
- Heuristic move labels based on evaluation changes.
- Local Stockfish analysis works without an API key. Optional Gemini or Groq explanations use your selected provider's API key and usage limits.

## Important limitations of this first MVP

- The extension adds an “Analyze with Zen” button to supported Chess.com game URLs. Clicking it retrieves the finished game PGN from Chess.com's public monthly archive and opens the separate review page automatically. The game must be completed and publicly available in the archive; if Chess.com has not published it yet, the extension will explain that.
- The lite engine is intentionally compact. The default is 0.5 seconds for each position and analysis checks both before and after every ply, so long games can take a few minutes.
- Labels and explanations are heuristic approximations, not Chess.com's proprietary Game Review model. The first coaching text is intentionally rule-based; richer tactical explanations are the next milestone.
- This starter needs Node.js/npm to build and fetch the local dependencies once. After building, the review and engine run locally.

## Automatic import behavior

The content script adds a fixed “Analyze with Zen” button on Chess.com live/daily game URLs. It requests the game's callback metadata, then looks up the exact game URL in the public monthly archive and transfers the PGN to the extension review page using `storage.local`. It does not inspect or analyze the live board. Only a PGN present in the public finished-game archive is accepted. Chess.com callback endpoints are undocumented and may change; if the import fails, retry later or use manual PGN import as a fallback.

## Build on Windows

1. Install a current Node.js LTS release from https://nodejs.org/ (npm is included).
2. Extract this folder somewhere simple, e.g. `C:\Users\YourName\Documents\zen-chess-review`.
3. Open Command Prompt or PowerShell in that folder.
4. Run:

   ```powershell
   npm install
   npm run build
   ```

   This downloads `chess.js`, Vite, and the Stockfish npm package, then copies the Stockfish single-threaded WASM files into the extension. The build output is in `dist`.

5. Open Zen Browser and enter `about:debugging` in the address bar.
6. Choose **This Firefox** → **Load Temporary Add-on**.
7. Open the `dist` folder and select `manifest.json`.
8. Click the Zen Chess Review toolbar icon → **Open Game Review**.
9. On Chess.com, open a completed game. Click **Share** → **PGN** → **Download**. On the review page's empty board, choose **Import PGN file** to load the downloaded game, then select **Analyze game**. Alternatively, select **Paste PGN**, paste the game, and select **Load game** (or press Ctrl/Cmd + Enter). Import controls also remain available in the menu.

Temporary add-ons may be removed when Zen restarts. To test code changes, rebuild and use the extension's Reload button in `about:debugging`.

## Troubleshooting

- **Build says Stockfish files could not be found:** inspect `node_modules\stockfish\bin`. Package layouts can change between versions. Update `scripts/copy-engine.mjs` to match the installed file names, then run `npm run build` again.
- **Engine fails to start:** confirm `dist\engine` contains both `stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm`; reload the extension.
- **PGN won't load:** use a PGN downloaded from Chess.com or paste the full PGN including move text.
- **Review takes too long:** choose Quick (0.25 sec) or analyze shorter games first.
- **Extension is not retained after restart:** temporary loading is for development. A permanent Firefox/Zen install generally requires a signed add-on package.

## Engine settings

- Single-threaded WASM engine: one CPU worker, so the thread setting cannot be increased.
- Per-position time: 250 / 500 / 1000 ms.
- Selecting an unevaluated position requests a quick local evaluation. New variation moves are analyzed automatically using the selected per-position time.

## Exploring variations

1. Select a position in the original game's move list and play an alternative move on the board.
2. Continue playing to explore the line. Stockfish evaluates each new move and adds its classification, recommended continuation, and coaching feedback.
3. Click **Back to game - [move]** to return to the exact original-game position where that variation started. The next navigation step follows the original game's continuation.
4. Reopen any saved variation by clicking its moves in the indented move list. Branches can be expanded or collapsed; playing a different reply within a variation creates a nested branch. **Back to parent branch** returns to the nearest nested fork.

Left/Right arrows and the navigation buttons follow the selected line. Up goes to the imported game's initial position; Down goes to the selected line's end. Pawn promotion offers Queen, Rook, Bishop, and Knight.

The Game Summary always describes the original game. Exploring alternatives preserves its evaluations, classifications, accuracy, and rating estimates. Moving pieces during a full-game review stops that review safely; **Analyze game** resumes using completed results.

Variations and their analyses remain available in the current review session. Loading another PGN or reloading the page clears them. Saving studies across sessions and exporting PGNs with variations are not included.

## Moving pieces and planning on the board

Click a piece and its destination, or drag it onto a legal square. Legal destinations appear while dragging. Dropping outside the board or on an illegal square cancels the move. Promotion opens the Queen/Rook/Bishop/Knight picker. Escape cancels an unfinished drag or drawing; navigation, board flipping, and game import also cancel active gestures.

The engine's best-move arrow is translucent light blue. Selecting pieces leaves its analysis request running. If the engine cannot provide a legal suggestion, use **Retry** beside its status; terminal positions have no best-move arrow.

The board uses Lichess's default cream and brown colors. When a new variation position is still being analyzed, the evaluation bar holds its last score and moves to the new evaluation when available. Loading another game resets the display.

Right-drag between any two squares to draw a planning arrow, or right-click a square to add a circle. Repeat an annotation to remove it. Drawing over the same endpoints with another color changes its color:

| Modifier with right-click/drag | Color |
| --- | --- |
| None | Green |
| Ctrl | Red |
| Alt (or Meta) | Blue |
| Ctrl + Alt | Yellow |

Planning annotations remain visible while the engine updates and when you flip the board. Left-clicking the board, making a move, navigating to another position, or loading a game clears them. The best-move arrow toggle affects only the engine suggestion. Planning arrows do not change the game or start engine analysis.

## Optional Gemini or Groq explanations

Without an API key for the selected provider, move feedback and Stockfish analysis run locally as before. Open **Menu > AI Coach**, choose **Gemini** or **Groq**, create a key in [Google AI Studio](https://aistudio.google.com/app/apikey) or [Groq Console](https://console.groq.com/keys), paste it, and select **Save**. Select an analyzed move to verify the connection. The status distinguishes a saved key from a successful connection. Each provider's pricing, access requirements, and quota limits apply.

AI requests are manual: select **Ask AI** for an eligible analyzed move to request an explanation. Saving a key, navigating, flipping the board, or updating Stockfish analysis does not automatically send an AI request. Book and forced moves retain local feedback. Previously requested explanations can be reopened from the cache without another call. Long explanations scroll within the feedback area while the move list and footer keep their own space.

Drag the divider above **Moves / Game Summary** up to expand the lower section, or down to expand feedback. Your chosen split is remembered after reloading and adapts to smaller screens. Focus the divider and use **Up / Down** to adjust it or **Home / End** to reach its limits. Double-click the divider to restore the automatic layout.

With a working key, the feedback panel explains the move, tactics, positional considerations, Stockfish's recommendation, and a practical takeaway. It uses the before/after positions, board facts, and legally replayed Stockfish lines for the selected original-game or variation move. Scores and classifications remain Stockfish-based; the selected AI provider supplies language, which can still contain mistakes. The local explanation remains available while loading or when a request fails. **Retry AI** retries that position; otherwise failed requests are not repeatedly sent on each render.

Keys are saved separately in this browser profile. Existing Gemini keys continue to work. Gemini authenticates only with Google using `x-goog-api-key`; Groq uses `Authorization: Bearer` only at `api.groq.com`. Only the selected provider receives the position, played move, board facts, and engine evidence. Player names and the full PGN are not included. Switching providers cancels pending requests and retains both saved keys; it does not automatically try another provider after a failure. **Clear API key** removes only the selected provider's key and returns its feedback to local mode, even if the other provider has a saved key. The selected provider is remembered after reloading.

Explanations are cached in memory by provider, model, position, and engine evidence. The Groq adapter uses `openai/gpt-oss-120b` with strict JSON schema output; the Gemini adapter uses `gemini-3.8-flash`.

## Development checks

Use Node.js 22.20+ or a newer supported LTS release. After `npm ci`:

```powershell
npm test
npx playwright install chromium firefox
npm run test:browser
```

Unit tests cover branching, return positions, special moves, board coordinates, suggestion validation, and engine queue cancellation/recovery. Browser tests exercise the generated review page in Chromium and Firefox with the packaged Stockfish worker and WASM, including drag-and-drop, planning annotations, gesture cancellation, variations, and game summaries. Controlled delayed-worker tests also verify suggestion recovery and uninterrupted requests during piece selection.

Gemini and Groq client checks use local HTTP contract simulations, require Postman CLI 1.75+, and need no real API key or Postman login:

```powershell
npm run test:coaching
```

These checks exercise success, caching, deeper Stockfish analysis, key removal, late responses, explicit retry, invalid keys, quota limits, server failures, invalid/blocked responses, safe text rendering, and timeouts in both browsers. They establish client behavior against fixtures; live provider access and chess explanation quality require a separate manual check with your own key. See [simulation details](postman/README.md).

To load the extension itself in Firefox/Zen, run `npm run build`, open `about:debugging`, select **This Firefox > Load Temporary Add-on**, and choose `dist/manifest.json`.

## Privacy and fair play

- With no key for the selected AI provider, PGN and chess analysis stay in the browser after dependencies are installed. With a key saved, the selected position and engine context are sent only to that provider for explanations, as described above.
- Use this only for completed games or independent study. Do not use engine analysis during live games.
- Stockfish is GPL-licensed. Keep the upstream license notice with the distributed engine and comply with its license if redistributing builds.
