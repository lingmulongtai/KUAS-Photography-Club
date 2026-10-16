/**
 * Posts to show in the Instagram section, newest first.
 * Instagram has no public feed for static sites, so list the posts by hand:
 * `url` is the post's link and `image` a photo saved under public/ (with the photographer's permission).
 * While the list is empty, the section shows only the profile link and contact guidance.
 */
export interface InstagramPost {
  url: string;
  image: string;
  alt: string;
}

export const instagramPosts: InstagramPost[] = [];
