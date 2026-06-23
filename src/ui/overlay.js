// DOM-overlay layer for the non-gameplay scenes (picker, summary, title, game over).
// The game canvas is internally 800×600 but CSS-scales responsively (styles.css), so the
// overlay is a fixed 800×600 "stage" transform-scaled to sit exactly on top of the canvas's
// live rect. Menu scenes build real HTML/CSS here (high-fidelity ports of the approved
// comps) while the RUN scene keeps drawing to the canvas underneath; main.js hides the
// overlay for the run and each DOM scene shows it on mount.
let overlay = null, stage = null;

function ensure() {
  if (overlay) return;
  const canvas = document.getElementById("game");

  // The approved comps use these three families (Anton / Oswald / Space Mono). They're
  // self-hosted under assets/fonts/ (relative path — no CDN) so the menu scenes render
  // right with no network, e.g. inside the itch sandbox. Relative to the page, not this
  // module. (Still degrades to the CSS stack's system fonts if the files are absent.)
  if (!document.getElementById("ui-fonts")) {
    const link = document.createElement("link");
    link.id = "ui-fonts"; link.rel = "stylesheet";
    link.href = "assets/fonts/fonts.css";
    document.head.appendChild(link);
  }

  overlay = document.createElement("div");
  overlay.id = "ui-overlay";
  // Critical layout set inline (not reliant on styles.css, which a dev server may serve
  // stale from cache): fixed over the canvas, click-through except inside the stage.
  Object.assign(overlay.style, { position: "fixed", zIndex: "10", display: "none", pointerEvents: "none" });
  stage = document.createElement("div");
  stage.className = "ui-stage";
  Object.assign(stage.style, {
    width: "800px", height: "600px", transformOrigin: "top left",
    position: "relative", overflow: "hidden", pointerEvents: "auto", userSelect: "none",
  });
  overlay.appendChild(stage);
  document.body.appendChild(overlay);

  const sync = () => {
    const r = canvas.getBoundingClientRect();
    overlay.style.left = r.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    stage.style.transform = `scale(${r.width / 800})`;
  };
  sync();
  addEventListener("resize", sync);
  addEventListener("scroll", sync, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(sync).observe(canvas); // catch layout-driven resizes
  overlay._sync = sync;
}

// Mount a scene's root element as the stage's sole child and reveal the overlay.
export function mountOverlay(el) {
  ensure();
  stage.replaceChildren(el);
  overlay.style.display = "block";
  overlay._sync();
}

// Hide the overlay and clear it (the canvas RUN scene shows through underneath).
export function hideOverlay() {
  if (overlay) { overlay.style.display = "none"; stage.replaceChildren(); }
}
