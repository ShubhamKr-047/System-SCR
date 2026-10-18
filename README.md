# Zen Chess Review (starter MVP)

A free Firefox/Zen WebExtension starter for reviewing **completed** Chess.com games with a local Stockfish WebAssembly engine. It opens a separate review page. It does not read or analyze live games.

## What is included

- Separate review page with a board, move list, navigation, PGN import, and feedback panel.
- PGN import by file or pasted text.
- Local Stockfish integration (lite, single-threaded build) and adjustable per-position time.
- Heuristic move labels based on evaluation changes.
- No paid APIs or cloud analysis.

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
9. On Chess.com, open a completed game. Click **Share** → **PGN** → **Download**. Return to the review page, choose the downloaded `.pgn`, click **Load game**, then **Analyze game**.

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
- No engine work runs until the user presses Analyze game.

## Privacy and fair play

- PGN and analysis stay in the browser after dependencies are installed; no game data is sent to a server by this extension.
- Use this only for completed games or independent study. Do not use engine analysis during live games.
- Stockfish is GPL-licensed. Keep the upstream license notice with the distributed engine and comply with its license if redistributing builds.
