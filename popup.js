document.getElementById("openReview").addEventListener("click", () => {
  const api = globalThis.browser ?? globalThis.chrome;
  api.tabs.create({ url: api.runtime.getURL("review.html") });
  window.close();
});