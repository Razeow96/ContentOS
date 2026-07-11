How to add a source

Open sources.json in VS Code (it will underline any JSON mistake in red before you save).
Copy one of the blocks from _examples_for_later into the sources array.
Fill in name, type, url, field_map, defaults.
If it needs a key, set auth_ref to the name of an n8n credential (create that credential in n8n separately). Never paste the key here — this file is committed to GitHub.
Commit. The Trend workflow picks it up on its next run.
To make a page actually receive it, add a row in Supabase page_trend_sources.


The three source types

api — a JSON REST API (e.g. YouTube). Config-only. The API skeleton calls the url, reads response_items_path for the array, applies field_map.
rss — an RSS/XML feed (e.g. Google Trends). Config-only. The RSS skeleton parses feed items and applies field_map.
scrape — a page/endpoint with no clean API (e.g. Dcard). The only type that may need a small code fill-in in the Scrape skeleton. Everything around it (scope handling, normalize, emit) is shared.

Placeholders vs new sources


url an contain {region}, {language}, {chart}, {max}, {auth}. These are filled at run time from each page's subscription params. So one youtube entry serves TW-zh AND US-en pages.
A different response shape (e.g. YouTube Shorts returning different JSON) is its own entry with its own field_map — not a placeholder. Rule of thumb: same shape, different values → placeholder. Different shape → new entry.


field_map

Maps the platform's response onto the standard TrendDetected fields. Keys are our field names; values are the path in the platform's response.
Example: "topic": "snippet.title" means "the trend's topic is found at snippet.title in YouTube's response."
Target fields available: topic (required), category, keywords, region, country, language, score, rank, signal_type, external_id, url, detected_at.