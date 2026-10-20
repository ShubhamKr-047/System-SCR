const SOUND_URLS = {
  move: "/sounds/move.mp3",
  capture: "/sounds/capture.mp3",
  brilliant: "/sounds/brilliant.wav",
  castle: "/sounds/castle.mp3",
  check: "/sounds/check.mp3",
  illegal: "/sounds/illegal.mp3",
  gameEnd: "/sounds/game-end.mp3",
  draw: "/sounds/game-draw.mp3"
};

const audioCache = {};

function getSoundUrl(type) {
  const isExtension = typeof browser !== "undefined" && Boolean(browser?.runtime?.id);
  const relativePath = SOUND_URLS[type] || SOUND_URLS.move;
  if (isExtension) {
    return browser.runtime.getURL(relativePath.replace(/^\//, ""));
  }
  return relativePath;
}

export function playSound(type = "move") {
  try {
    if (typeof window === "undefined" || typeof Audio === "undefined") return;
    const url = getSoundUrl(type);
    let sound = audioCache[url];
    if (!sound) {
      sound = new Audio(url);
      audioCache[url] = sound;
    }
    sound.currentTime = 0;
    const playPromise = sound.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay policy or un-interacted document catch
      });
    }
  } catch {
    // Ignore audio playback error
  }
}
