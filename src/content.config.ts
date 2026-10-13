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

/**
 * One Markdown file per month in src/content/schedule/ (e.g. 2026-10.md).
 * Every Friday gets the weekly meeting automatically unless listed in noMeeting.
 */
/** YAML turns 2026-10-24 into a Date; keep dates as plain YYYY-MM-DD strings. */
const day = z.preprocess((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

const schedule = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/schedule' }),
  schema: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    weeklyMeeting: z.boolean().default(true),
    /** Fridays without the weekly meeting, as YYYY-MM-DD. */
    noMeeting: z.array(day).default([]),
    sample: z.boolean().default(false),
    events: z
      .array(
        z.object({
          date: day,
          title: z.string(),
          kind: z.enum(['meeting', 'trip', 'event', 'deadline', 'other']).default('event'),
          time: z.string().optional(),
          place: z.string().optional(),
          note: z.string().optional(),
          link: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

export const collections = { trips, guidelines, schedule };
