/** Runs inside the real Renderer; checks rendered cells, including explicit ANSI backgrounds. */
export function terminalContrastSnapshot() {
  const host = document.querySelector(".terminal-host");
  if (!host) return { samples: 0, minimum: 0, transparentLayers: false };
  const rgba = (text) => (text.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = (color) =>
    rgba(color)
      .slice(0, 3)
      .map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const samples = [...host.querySelectorAll(".xterm-rows span")].filter(
    (span) =>
      /ANSI_|TRUECOLOR_|SAME_FOREGROUND|Artemis>/.test(span.textContent ?? ""),
  );
  const contrasts = samples.map((span) => {
    let background = span;
    while (
      background &&
      rgba(getComputedStyle(background).backgroundColor)[3] === 0
    )
      background = background.parentElement;
    const fg = luminance(getComputedStyle(span).color);
    const bg = luminance(getComputedStyle(background ?? host).backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  return {
    samples: samples.length,
    minimum: Math.min(...contrasts),
    background: getComputedStyle(host).backgroundColor,
    transparentLayers: [
      ...host.querySelectorAll("canvas, .xterm-helper-textarea"),
    ].every((node) => rgba(getComputedStyle(node).backgroundColor)[3] === 0),
  };
}
