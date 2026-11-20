/**
 * Members' photos for the reel on the home page, until outing records are published.
 *
 * Add a photo:
 *   1. Put the file in public/photos/members/ (about 1200 px on the long side; portrait works best).
 *   2. Add an entry below. `by` is the credit the photographer agreed to (name or @account).
 *   3. Only add photos whose photographer has agreed to them being shown on the site.
 *
 * While this list is empty the reel shows drawn cards for the places the club photographs.
 * Published outing records (src/content/trips/) take precedence over this list.
 */
export interface MemberPhoto {
  /** e.g. '/photos/members/kamogawa-dusk.jpg' */
  src: string;
  /** what the photo shows, for people who cannot see it */
  alt: string;
  /** the photographer's agreed credit */
  by: string;
  /** where it was taken, shown on the card */
  place: string;
  placeEn?: string;
}

export const memberPhotos: MemberPhoto[] = [
  // { src: '/photos/members/kamogawa-dusk.jpg', alt: '夕暮れの鴨川と川床', by: '@example', place: '鴨川', placeEn: 'Kamo River' },
];
