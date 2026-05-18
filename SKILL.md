---
name: video-analyst
description: Use when the user wants an agent to analyze local videos, match them to YouTube videos, run the Video Analytics CLI, combine transcript, Qwen visual analysis, YouTube Data API and YouTube Analytics, and produce publication reports with recommendations.
---

# Video Analyst

This skill operates from `skills/video-analyst`, where the CLI project files live next to this `SKILL.md`.

Use it when the user asks for a full video report, YouTube publication analysis, transcript plus visual scenario, retention/comments recommendations, or batch analysis of local videos.

## Safety Rules

- Never print API keys, OAuth tokens, refresh tokens, `.env`, or `.system/youtube-oauth-token.json`.
- Do not commit or quote local analysis artifacts from `outputs/` or `.system/` unless the user explicitly asks for a sanitized sample.
- Do not download YouTube videos. Visual analysis requires a local `--video` file.
- Treat reports, transcripts, local paths, channel analytics, comments, and generated audio/video previews as private by default.
- Thumbnail CTR is not available from this CLI; report it as `unsupported_by_youtube_analytics_api`.

## Setup Check

Work from the skill/project root:

```bash
cd skills/video-analyst
npm test
```

Expected external tools for the default path:

- Node.js 24+
- `ffmpeg`
- `ffprobe`
- `whisper-cli`
- local Whisper model at `VIDEO_ANALYTICS_WHISPER_MODEL`

Configured secrets live in `.env`:

- `OPENROUTER_API_KEY` for Qwen visual analysis and optional OpenRouter STT
- `YOUTUBE_API_KEY` for public YouTube Data API
- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` for YouTube Analytics

If OAuth is needed, run:

```bash
npm run youtube:auth
```

## Core Commands

Single video:

```bash
npm run analyze -- --video "/path/to/video.mov" --youtube-id VIDEO_ID --title "Video title"
```

With YouTube URL:

```bash
npm run analyze -- --video "/path/to/video.mov" --youtube-url "https://youtu.be/VIDEO_ID"
```

Batch manifest:

```bash
cp inputs/videos.example.jsonl inputs/videos.jsonl
npm run analyze -- --input inputs/videos.jsonl
```

`inputs/videos.jsonl` is local and ignored because it can contain private absolute paths and real YouTube IDs.

Optional OpenRouter STT:

```bash
npm run analyze -- --video "/path/to/video.mov" --youtube-id VIDEO_ID --transcriber openrouter-stt
```

## Matching A Local Video To YouTube

If the user gives both local video and YouTube URL/ID, use that ID.

If the user only gives a local video:

1. Inspect duration with `ffprobe`.
2. Search likely channel uploads with YouTube Data API when `YOUTUBE_API_KEY` is configured.
3. Match by title hints, duration, upload date, and transcript clues.
4. If still ambiguous, run analysis without YouTube ID, read the transcript, then search again by exact phrases.
5. If multiple candidates remain plausible, ask the user for the correct URL instead of guessing.

## Output Artifacts

For a video stem `<stem>` and run `<run_id>`, expect:

```text
outputs/<stem>/
  ТРАНСКРИПТ_<stem>.md
  ВИЗУАЛЬНЫЙ_СЦЕНАРИЙ_<stem>.md
  YOUTUBE_<youtube_id>.json
  RUN_<run_id>.json

.system/<run_id>/
  fingerprint.json
  ffprobe.json
  audio.wav
  transcript.raw.json
  qwen.request.json
  qwen.response.json
  youtube.video.json
  youtube.channel.json
  youtube.latest-uploads.json
  youtube.comments.json
  youtube.captions.json
  youtube.analytics-summary.json
  youtube.analytics-daily.json
  youtube.analytics-retention.json
  youtube.analytics-traffic-sources.json
  youtube.analytics-traffic-details.json
  youtube.analytics-subscribed-status.json
  youtube.analytics-geography.json
  youtube.analytics-devices.json
  youtube.analytics-demographics.json
  youtube.analytics-engagement.json
  youtube.channel-benchmark.json
```

## Report Workflow

Create a final publication report when the user asks for a full video report, YouTube publication analysis, recommendations, "same report for this video", or a complete run from local video to conclusions. Do not create this report when the user only asks to run the CLI, inspect raw artifacts, or debug setup.

After `npm run analyze`, read:

- transcript Markdown
- visual scenario Markdown
- `YOUTUBE_<youtube_id>.json`
- run manifest
- any available extended YouTube artifacts: traffic sources/details, subscribed status, geography, devices, demographics, engagement, channel benchmark

Create the report at:

```text
outputs/reports/YOUTUBE_REPORT_<youtube_id>.md
```

Write the report in the user's language. Use emoji only in section headings and a few status labels; keep the analysis itself sober and specific.

Use this 12-section structure:

1. `🎯 Главный вывод`
   State what happened with the publication, whether the video worked, and the most important reason. Keep it to 3-5 strong sentences.

2. `📌 Паспорт видео`
   Include title, YouTube ID or URL, publish date if available, duration, local file/stem, channel title, run ID, and artifact paths.

3. `📊 Метрики публикации`
   Include public stats and private Analytics when available: views, watch time, average view duration, average view percentage, likes, comments, subscribers gained/lost. Explain any mismatch between public counters and Analytics.

4. `📈 Динамика по дням`
   Summarize daily rows: launch spike, decay, tail, unusual jumps, and whether the video continued receiving attention after the first day.

5. `🧲 Удержание`
   Summarize retention rows when available: first drop, strongest segments, weak segments, rewatch peaks, and what that means for editing. If retention is missing, state the exact status and do not invent retention points.

6. `🎬 Реальный сценарий видео`
   Reconstruct the actual video as a Markdown table with exactly these columns:

   ```markdown
   | Время | Видеоряд | Аудиоряд | Комментарий |
   |---|---|---|---|
   | 00:00-00:05 | What appears on screen: scenes, objects, screen states, on-screen text/OCR, actions, transitions, pacing. | Transcript of what the speaker says in this moment, using the real transcript. | Report author's note: why this moment works or fails, what it does for attention, clarity, trust, emotion, or retention. |
   ```

   `Время` is a timecode moment or interval. `Видеоряд` describes only the visual layer from Qwen/video evidence. `Аудиоряд` contains the corresponding spoken transcript, not a paraphrase. `Комментарий` is for the report author's analysis. Keep rows compact, but cover all meaningful beats of the video.

7. `🧠 Почему сработало / не сработало`
   Connect data to creative causes: topic, hook, promise, clarity, novelty, platform fit, audience expectation, visual proof, and pacing.

8. `💬 Комментарии и сигналы аудитории`
   Include top comments and audience signals if comments are available. Extract repeated questions, confusion, praise, objections, and ideas for future videos. If comments are unavailable, mark the section as skipped with status.

9. `🛠 Что улучшить`
   Give concrete recommendations for title, thumbnail, first 3 seconds, structure, demonstration, edit tempo, CTA, subtitles/OCR, and description. Do not recommend CTR changes as measured facts unless CTR data was explicitly provided.

10. `🚀 Следующий эксперимент`
    Define one next experiment: hypothesis, what to change, what to keep constant, expected effect, success metric, and when to check results.

11. `🗂 Технический статус`
    List which data was available: transcript, Qwen visual analysis, YouTube Data API, Analytics summary, daily rows, retention rows, comments, captions metadata. Link or name the transcript, visual scenario, YouTube JSON, and run manifest.

12. `🎞 Возможная версия сценария v2`
    Propose a better version of the video's scenario that accounts for the discovered weaknesses and should reveal the material more clearly while increasing reach. Base it on the actual data and analysis: stronger hook, clearer promise, better order of ideas, stronger visual proof, tighter pacing, more useful examples, better CTA, and platform fit. Present it as a practical outline with time blocks, not as vague advice.

Required sections: 1-7, 9-12. Section 8 is optional only when comments are unavailable. Retention data is optional, but the retention section itself is mandatory and must explain the status.

Ground every report in the actual transcript, Qwen visual scenario, YouTube public stats, Analytics summary/daily/retention, and comments. Never invent CTR, revenue, retention, comments, or traffic-source data. If a metric is absent, say it is absent and explain what can still be inferred.

## Validation

Before reporting completion:

```bash
npm test
```

In the final answer, include the matched YouTube ID, run ID, report path, transcript path, visual scenario path, YouTube JSON path, and test result.
