# System SCR

System SCR is a browser extension for reviewing completed chess games with Stockfish 19. Open a game from Chess.com or Lichess, or import a PGN, to see where the evaluation changed and explore what you could have played instead. Stockfish runs in your browser. The optional AI Coach uses your own Groq API key to explain individual moves.

## Build and install

Use Node.js 22 or newer and npm.

```sh
git clone https://github.com/ShubhamKr-047/System-SCR.git
cd System-SCR
npm ci
npm run build
```

The build copies the Stockfish engine and creates a loadable extension in `dist/`.

| Browser | Load the build |
| --- | --- |
| Firefox or Zen | Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**, then select `dist/manifest.json`. See [Mozilla's temporary install guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/). |
| Chrome or Chromium | Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `dist/` folder. See [Chrome's unpacked extension guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked). |

After installing, click the rook icon and select **Open System SCR**. After rebuilding, reload the extension and refresh any open review or chess-site tabs.

A temporary Firefox installation ends when Firefox restarts. To keep it installed in standard Firefox, submit an archive containing the files inside `dist/` for Mozilla signing. Choose self-distribution to keep the extension unlisted, then install the signed `.xpi` through `about:addons`. The [manifest](manifest.json) sets the minimum Firefox version. See [Mozilla's self-distribution guide](https://extensionworkshop.com/documentation/publish/self-distribution/).

## Review a game

1. Use **Import PGN** or **Paste PGN**, or click **Analyze** on a supported completed game on Chess.com or Lichess.
2. In Game Review, click **Review**. Choose **Quick**, **Balanced**, or **Deep** from the menu to control how much time Stockfish spends on the game. The review first covers the main line, then uses its remaining time to check moves that need more evidence.
3. Select a move from the list or evaluation graph. The feedback panel shows the move classification and Stockfish's recommended continuation. **Show Move** plays that line on the board. **Go back** returns to the reviewed move.
4. Play an alternative on the board to explore a variation. From a completed preview, playing a legal move saves the continuation as a variation.

The board supports click-to-move and drag-and-drop. Right-click a square to mark it, or right-drag to draw an arrow.

| Key | Action |
| --- | --- |
| Left / Right | Step backward or forward |
| Up / Down | Jump to the start or end of the current line |
| F or X | Flip the board |
| Escape | Exit a preview or stop playback and clear the board selection |

Review labels such as **Brilliant**, **Great**, and **Miss** follow System SCR's own criteria. The [project guide](docs/project-guide.md) explains how the engine evidence supports them.

## AI Coach

Enable **AI Coach** in the menu, enter your [Groq API key](https://console.groq.com/keys), and click **Save**. Select an analyzed move and click **Explain** for an Intermediate explanation. The coach uses local chess evidence and may reuse a saved explanation. Saving a key or browsing moves does not send a Groq request. If a request fails or is held by the quota limiter, the coach shows local feedback.

## Data and permissions

PGN analysis and Stockfish searches run locally. The extension contacts Chess.com and Lichess to detect and import completed games. Those requests use game IDs, and Chess.com archive lookup also uses a public player handle and game month.

When the coach needs Groq, it sends the selected chess position and supporting evidence. It sends the API key in the authentication header. Player names, ratings, and the full PGN are outside the coaching payload. The installed extension stores the key in extension storage and caches explanations in IndexedDB.

## Development

To work on the review page without installing the extension, run `npm run copy-engine` and `npm run dev`, then open `/review.html` on the local URL Vite prints. The website launchers and extension messaging require an installed build.

```sh
npm test
npx playwright install chromium firefox
npm run test:browser
```

`npm run test:coaching` and `npm run test:lichess` also require the Postman CLI. These suites use local service simulations. See the [simulation setup](postman/README.md). For source layout, engine policy, and benchmark commands, see the [project guide](docs/project-guide.md).

System SCR bundles Stockfish through the [Stockfish npm package](https://www.npmjs.com/package/stockfish). The opening index is generated from [Lichess's CC0 chess openings dataset](https://github.com/lichess-org/chess-openings). Font license notices are included in [public/fonts](public/fonts/).
