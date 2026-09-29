import {
  DOCS_URL,
  localize,
  siteUrl,
  type Lang,
} from "../pages/examples/sections";

import { GITHUB_URL } from "./SiteHeader";

/** Footer strings (the gallery's own chrome, not example content). */
const UI = {
  docs: { en: "Docs", ja: "Docs" },
  github: { en: "GitHub", ja: "GitHub" },
  brandAssets: { en: "Brand Assets", ja: "ブランドアセット" },
  credit: "Navara · MIT / Apache-2.0",
} as const;

type SiteFooterProps = {
  lang: Lang;
};

/**
 * The Navara site footer, mirroring the landing page footer
 * (docs/src/components/LpFooter.astro): a centered link row and the license
 * credit, on the navy band, set off from the content by a hairline.
 */
export const SiteFooter = ({ lang }: SiteFooterProps) => {
  const links = [
    { label: UI.docs, href: `${DOCS_URL}${lang === "ja" ? "/ja" : ""}/` },
    { label: UI.github, href: GITHUB_URL },
    { label: UI.brandAssets, href: siteUrl(lang, "brand-assets/") },
  ];
  return (
    <footer className="border-t border-border/50 px-12 pb-12 pt-14 text-center max-[960px]:px-8 max-[960px]:pb-10 max-[960px]:pt-11 max-[640px]:px-5 max-[640px]:pt-12">
      <nav className="flex flex-wrap justify-center gap-x-[26px] gap-y-4 text-sm font-medium max-[640px]:gap-x-[22px]">
        {links.map((link) => (
          <a
            key={link.href}
            className="text-foreground no-underline hover:text-primary"
            href={link.href}
          >
            {localize(link.label, lang)}
          </a>
        ))}
      </nav>
      <p className="mt-7 text-xs text-muted-foreground">{UI.credit}</p>
    </footer>
  );
};
