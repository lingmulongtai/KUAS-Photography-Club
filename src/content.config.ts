import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * One Markdown file per photo trip in src/content/trips/.
 * The body is the trip report; `photos` lists the pictures shown on the film strip and in the gallery.
 */
const trips = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/trips' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    place: z.string(),
    /** How many members came. */
    members: z.number().int().positive().optional(),
    /** One sentence for lists and link previews. */
    summary: z.string(),
    /** Sample content shipped with the site; shown with a badge until replaced. */
    sample: z.boolean().default(false),
    photos: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string(),
          /** Photographer, credited as "© name / KUAS Photography Club (year)". */
          by: z.string(),
          caption: z.string().optional(),
          portrait: z.boolean().default(false),
        }),
      )
      .min(1),
  }),
});

/** The club guidelines, read straight from the repository's guidelines/ folder. */
const guidelines = defineCollection({
  loader: glob({
    pattern: ['club_guidelines.md', 'club_guidelines_en.md', 'multilingual-support/club_guidelines_*.md'],
    base: './guidelines',
    generateId: ({ entry }) => {
      const m = entry.match(/club_guidelines_([\w-]+)\.md$/);
      return m ? m[1] : 'ja';
    },
  }),
});

export const collections = { trips, guidelines };
