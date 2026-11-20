/**
 * Photographs for the About page: three prints in the opening collage and one for each activity.
 *
 * Add a photo:
 *   1. Put the file in public/photos/about/ (about 1200 px on the long side).
 *   2. Replace the matching `null` below. `by` is the credit the photographer agreed to.
 *   3. Only add photos whose photographer has agreed to them being shown on the site.
 *
 * While a slot is `null` the page shows a drawn placeholder print in its place.
 */
export interface AboutPhoto {
  /** e.g. '/photos/about/minoh-falls.jpg' */
  src: string;
  /** what the photo shows, for people who cannot see it */
  alt: string;
  altEn?: string;
  /** the photographer's agreed credit (name or @account) */
  by: string;
}

export const aboutPhotos: {
  collage: [AboutPhoto | null, AboutPhoto | null, AboutPhoto | null];
  activities: { outings: AboutPhoto | null; exhibitions: AboutPhoto | null; campus: AboutPhoto | null };
} = {
  // { src: '/photos/about/minoh-falls.jpg', alt: '箕面大滝を撮る部員', altEn: 'Members photographing Minoh Falls', by: '@example' },
  collage: [null, null, null],
  activities: {
    outings: null,
    exhibitions: null,
    campus: null,
  },
};
