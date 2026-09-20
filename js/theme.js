// Theme, background colour and font size. All three are CSS custom properties on <html>.

export const COLOR_HUES = [340, 15, 45, 80, 140, 175, 200, 230, 265, 300];

const darkQuery = window.matchMedia(`(prefers-color-scheme: dark)`);

/** @param {object} settings */
export function applyTheme(settings) {
  const root = document.documentElement;
  const isDark = settings.theme === `dark` || (settings.theme === `auto` && darkQuery.matches);
  root.dataset.theme = isDark ? `dark` : `light`;
  root.dataset.font = settings.fontSize;
  root.style.setProperty(`--hue`, String(COLOR_HUES[settings.colorIdx] ?? COLOR_HUES[0]));
  const metaEl = document.querySelector(`meta[name="theme-color"]`);
  if (metaEl) metaEl.content = getComputedStyle(root).getPropertyValue(`--bg`).trim();
}

/** @param {() => object} getSettingsFunc */
export function followSystemTheme(getSettingsFunc) {
  darkQuery.addEventListener(`change`, () => applyTheme(getSettingsFunc()));
}
