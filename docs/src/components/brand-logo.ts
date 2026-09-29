// The brand logo, inlined into the page (an <img> would seal off its fills).
//
// The source files are the delivered exports under public/logo/svg/black/,
// which double as the downloadable brand assets: their viewBox keeps the clear
// space the brand reserves around the mark. In-page uses (header, LP hero)
// want the mark itself, so the viewBox is swapped for the tight content box
// (measured with getBBox on the paths and rounded outward; re-measure if the
// files are ever re-delivered). The black variant carries no fill attributes,
// so `fill: currentColor` lets CSS hand it the ink of whatever surface it sits
// on.
import horizontalRaw from "../../public/logo/svg/black/black_Navara_Horizontal_logo.svg?raw";
import verticalRaw from "../../public/logo/svg/black/black_Navara_Vertical_logo.svg?raw";

export type LogoKind = "horizontal" | "vertical";

const LOGOS: Record<LogoKind, { raw: string; tightViewBox: string }> = {
  horizontal: { raw: horizontalRaw, tightViewBox: "59.5 58.9 681.5 118.7" },
  vertical: { raw: verticalRaw, tightViewBox: "57.3 57.1 335.9 205" },
};

export function logoSvg(kind: LogoKind, className: string): string {
  const { raw, tightViewBox } = LOGOS[kind];
  return raw.replace(
    /<svg [^>]*>/,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${tightViewBox}" class="${className}" role="img" aria-label="Navara">`,
  );
}
