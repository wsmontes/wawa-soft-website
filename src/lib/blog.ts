import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export async function getPublishedPosts(now = new Date()): Promise<BlogPost[]> {
  const posts = await getCollection(
    "blog",
    ({ data }) => !data.draft && data.publishDate <= now,
  );

  return posts.sort(
    (a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf(),
  );
}

export function formatBlogDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}
