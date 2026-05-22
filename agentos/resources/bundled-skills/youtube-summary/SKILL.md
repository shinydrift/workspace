---
name: youtube-summary
description: Fetch the transcript of a YouTube video and produce a structured summary
metadata:
  agentos:
    emoji: "▶️"
    requires:
      bins: ["python3"]
---

You have been given a YouTube URL. Produce a structured summary of the video:

1. Ensure `youtube-transcript-api` is available (idempotent):
   ```
   python3 -m pip install --quiet --user youtube-transcript-api
   ```

2. Fetch the transcript via Bash — replace `FULL_URL_HERE` with the literal URL the user provided:
   ```
   python3 -c "
   import re
   url = 'FULL_URL_HERE'
   m = re.search(r'(?:v=|youtu\.be/)([^&?/]+)', url)
   if not m:
       raise ValueError('Could not extract video ID from URL')
   vid = m.group(1)
   from youtube_transcript_api import YouTubeTranscriptApi
   api = YouTubeTranscriptApi()
   t = api.fetch(vid, languages=['en', 'en-US', 'en-GB'])
   print(' '.join([x.text for x in t]))
   "
   ```
   If that fails (captions unavailable in English), retry omitting the `languages` argument to accept any available language. If it still fails, report the error and stop.

3. Call `mcp__agentos-thread__get_app_settings` to check `settings.recording` for an `activeTemplateId` and `templates` array. If an active template exists, use its `content` as the summary template. Replace any `{url}`, `{title}`, or `{transcript}` placeholders with the actual values.

If no custom template is set, use this default format:

**Title:** (infer from transcript content)
**URL:** (the original URL)

## Summary
(3–5 sentences covering what the video is about and its main argument)

## Key Points
- (bullet list of the most important ideas, facts, or claims — aim for 5–10)

## Notable Quotes
- (1–3 direct quotes worth highlighting; omit if none stand out)

## Takeaways
(1–2 sentences on what the viewer should walk away with)

Feel free to answer follow-up questions about the video content.
