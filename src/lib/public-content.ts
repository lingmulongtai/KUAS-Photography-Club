/** Apply at every public collection boundary, including prerendered admin data. */
export const isPublicContent = (entry: { data: { sample?: boolean; draft?: boolean } }) =>
  entry.data.sample !== true && entry.data.draft !== true;
