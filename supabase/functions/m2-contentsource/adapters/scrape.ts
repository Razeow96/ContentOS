// Web-article scrape adapter (type="scrape") — RAZ-25 mode='scrape', the no-feed case.
//
// Uses Bright Data's Web Unlocker (POST /request), NOT the datasets API: there is no per-site
// dataset for "some news site", and /request is a direct fetch that returns in seconds, so
// unlike a discover job it fits the sync budget and needs no n8n orchestration.
//
// Extraction is Open Graph first. Every real publisher emits og:* / article:published_time for
// their own share cards, so it is the closest thing to a universal article schema — and it is
// what the page ITSELF declares the article to be, rather than our guess at which <div> holds
// the body. Falls back to <title>/<meta name="description"> for pages without OG.

import { guardedFetch } from "../../m0-infrastructure/rate-limit/index.ts";
import type { MaterialJob } from "../service/types.ts";

const BD_REQUEST = "https://api.brightdata.com/request";

// Matches <meta property="og:title" content="..."> in either attribute order, single or
// double quotes. A DOM parser would be nicer but Deno Deploy has no DOM and pulling one in
// for four tags is not worth the dependency.
function meta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pats = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`, "i"),
    ];
    for (const p of pats) {
      const m = html.match(p);
      if (m && m[1] && m[1].trim()) return decode(m[1].trim());
    }
  }
  return null;
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export async function pullScrape(job: MaterialJob): Promise<unknown[]> {
  const key = Deno.env.get("BRIGHTDATA_API_KEY");
  if (!key) throw new Error("BRIGHTDATA_API_KEY not set");
  const zone = String(job.source.bd_zone ?? "").trim();
  if (!zone) throw new Error(`${job.source.name}: bd_zone not set — see get_active_zones`);

  // One page = one record. The gate bills per request here, not per article.
  const { res, done } = await guardedFetch(
    BD_REQUEST,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url: job.url, format: "raw" }),
    },
    { estimatedRecords: 1 },
  );
  if (!res.ok) throw new Error(`Web Unlocker ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const html = await res.text();
  await done(1);

  const title = meta(html, ["og:title", "twitter:title"]) ??
    decode((html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim());
  // No title = not an article we can use. Emitting it would fail normalize anyway (title is
  // required), so fail loudly here with the URL rather than silently return an empty record.
  if (!title) throw new Error(`no title found at ${job.url} — not an article page?`);

  return [{
    title,
    description: meta(html, ["og:description", "twitter:description", "description"]),
    image: meta(html, ["og:image", "twitter:image"]),
    published_time: meta(html, ["article:published_time", "og:article:published_time", "datePublished"]),
    author: meta(html, ["article:author", "author"]),
    site_name: meta(html, ["og:site_name"]),
    // og:url is the publisher's canonical; fall back to what we asked for.
    url: meta(html, ["og:url"]) ?? job.url,
    input_url: job.url,
  }];
}
