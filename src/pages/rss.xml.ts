import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getPublishedPosts } from "../lib/blog";
import { site } from "../data/site";

function makeContentUrlsAbsolute(html: string | undefined) {
  return html?.replace(
    /(href|src)="\/(?!\/)/g,
    `$1="${site.url}/`,
  );
}

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();

  return rss({
    title: `${site.name} Blog`,
    description:
      "Notes on independent software, open source, and the work behind Wawasoft products.",
    site: context.site ?? site.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishDate,
      link: `/blog/${post.id}`,
      content: makeContentUrlsAbsolute(post.rendered?.html),
      categories: post.data.tags,
      author: site.email,
    })),
    customData: "<language>en-ca</language>",
  });
}
