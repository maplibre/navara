/**
 * Presentation constants for {@link AttributionPlugin}: the shared `<style>`
 * element id, the ⓘ trigger icon markup, and the popover CSS. Extracted so the
 * bulky CSS string doesn't dominate the plugin class file.
 */

/** Shared `<style>` element id; reference-counted by the plugin. */
export const STYLE_ELEMENT_ID = "navara-attribution-styles";

/**
 * ⓘ trigger icon as a markup string, inserted via `innerHTML` so the icon can
 * be swapped in one place. `currentColor` makes it follow the button's color.
 */
export const SVG_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="10.5" stroke="currentColor" stroke-width="2" />
  <circle cx="12" cy="8" r="1" fill="currentColor" />
  <rect x="11" y="11" width="2" height="6" rx="1" fill="currentColor" />
</svg>`;

export const STYLE_TEXT = `
.navara-attr-dock {
  position: absolute;
  right: 8px;
  bottom: 8px;
  max-width: calc(100% - 16px);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  font-family: system-ui, sans-serif;
}
.navara-attr-dock--left {
  right: auto;
  left: 8px;
  align-items: flex-start;
}
.navara-attr-logoframe {
  position: absolute;
  left: 8px;
  bottom: 8px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Bottom-left mode: the ⓘ trigger (24px) occupies the far-left corner, so the
   logo frame starts to its right, keeping the two in a single row. */
.navara-attr-logoframe--left {
  left: 40px;
}
/* Mounted on <body>: anchor to the viewport instead of the page. */
.navara-attr-dock--fixed,
.navara-attr-logoframe--fixed {
  position: fixed;
}
.navara-attr-logo {
  height: 24px;
  width: auto;
  display: block;
  user-select: none;
}
.navara-attr-toggle {
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  border-radius: 50%;
  cursor: pointer;
  background: var(--nvr-attr-bg, rgba(252, 253, 254, 0.92));
  border: 1px solid var(--nvr-attr-border, rgba(0, 0, 0, 0.1));
  box-shadow: 0 2px 8px rgba(20, 24, 28, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--nvr-attr-link, #3a6595);
}
.navara-attr-toggle svg {
  width: 16px;
  height: 16px;
  display: block;
}
.navara-attr-card {
  width: 280px;
  max-width: 100%;
  max-height: 340px;
  overflow-y: auto;
  background: var(--nvr-attr-bg, rgba(252, 253, 254, 0.96));
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(20, 24, 28, 0.16);
  color: var(--nvr-attr-text, #1b1f24);
}
.navara-attr-card[hidden] {
  display: none;
}
/* display:flex on these beats the UA [hidden] rule, so hide explicitly. */
.navara-attr-dock[hidden],
.navara-attr-logoframe[hidden] {
  display: none;
}
.navara-attr-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--nvr-attr-border, rgba(0, 0, 0, 0.08));
}
.navara-attr-head h3 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--nvr-attr-title, inherit);
}
.navara-attr-close {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  color: var(--nvr-attr-nested, rgba(27, 31, 36, 0.64));
  padding: 2px 4px;
}
.navara-attr-list {
  list-style: none;
  margin: 0;
  padding: 12px;
}
.navara-attr-item + .navara-attr-item {
  margin-top: 15px;
}
.navara-attr-name {
  display: flex;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.navara-attr-bullet {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--nvr-attr-bullet, #3a6595);
  flex: none;
  margin-top: 6px;
}
.navara-attr-related {
  list-style: none;
  margin: 5px 0 0 13px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.navara-attr-related li {
  font-size: 12px;
  color: var(--nvr-attr-nested, rgba(27, 31, 36, 0.64));
  line-height: 1.5;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.navara-attr-card a {
  color: var(--nvr-attr-link, #3a6595);
  text-decoration: none;
}
.navara-attr-card a:hover {
  text-decoration: underline;
}
`;
