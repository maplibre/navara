import { Star } from "lucide-react";

import { withBase } from "../../helpers/base";
import { localize, type ExampleEntry, type Lang } from "../examples/sections";

import { NightlyBadge } from "@/components/NightlyBadge";

type ExampleGridProps = {
  entries: ExampleEntry[];
  lang: Lang;
};

export const ExampleGrid = ({ entries, lang }: ExampleGridProps) => {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-5 gap-y-8">
      {entries.map((entry) => {
        // Detail page and screenshot both key off the clean nested path,
        // mirroring the demo URL (/demo/<path>) the screenshot is captured from.
        const href = withBase(entry.path);
        const src = withBase(`screenshots/${entry.path}.avif`);
        const title = localize(entry.title, lang);
        const description = localize(entry.description, lang);
        return (
          <a
            key={entry.path}
            href={href}
            aria-label={`Open ${title}`}
            className="group block rounded-lg no-underline focus-visible:outline-none"
          >
            {/* Flat tile: only the thumbnail carries a border so it reads
                against the off-white page; the label sits plainly below. On
                keyboard focus it shows the shared ring color (matching the
                search input and header buttons) rather than the browser default. */}
            <div className="relative overflow-hidden rounded-lg border bg-muted ring-ring ring-offset-background group-focus-visible:ring-2 group-focus-visible:ring-offset-2">
              <img
                src={src}
                alt={title}
                className="block aspect-[16/10] w-full object-cover transition-opacity group-hover:opacity-90"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                }}
              />
              <NightlyBadge
                since={entry.since}
                lang={lang}
                className="absolute left-2 top-2"
              />
              {entry.signature && (
                <span className="absolute right-2 top-2 flex items-center rounded border border-border bg-background/80 p-1 backdrop-blur-sm">
                  <Star className="h-3 w-3 fill-current" />
                </span>
              )}
            </div>
            <div className="mt-3 space-y-1">
              <h3 className="text-sm font-medium">{title}</h3>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {description}
              </p>
            </div>
          </a>
        );
      })}
    </div>
  );
};
