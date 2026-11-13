import { isNightlyOnly, nightlyTooltip } from "../../../../site/release-status";
import type { Lang } from "../pages/examples/sections";

type NightlyBadgeProps = {
  /** The latest release + 0.0.1 when the feature landed, e.g. "0.3.2", or "nightly". */
  since: string | undefined;
  lang: Lang;
  /** Links the badge to this URL. Omit inside another link. */
  href?: string;
  className?: string;
};

/**
 * "Nightly" label for an example whose `since` is newer than the latest
 * release. Renders nothing once a release reaches `since`.
 */
export const NightlyBadge = ({
  since,
  lang,
  href,
  className,
}: NightlyBadgeProps) => {
  if (!since || !isNightlyOnly(since)) return null;
  const Tag = href ? "a" : "span";
  return (
    <Tag
      href={href}
      title={nightlyTooltip(since, lang)}
      className={`rounded border border-primary bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-primary-foreground no-underline ${className ?? ""}`}
    >
      Nightly
    </Tag>
  );
};
