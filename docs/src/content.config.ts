import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				// For a page about features not in the latest release: that release
				// + 0.0.1, e.g. "0.3.2". See src/components/NightlyBadge.astro.
				since: z
					.string()
					.regex(/^\d+\.\d+\.\d+$/)
					.optional(),
			}),
		}),
	}),
};
