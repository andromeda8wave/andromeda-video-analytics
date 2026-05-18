# Video Analytics

CLI MVP: принимает локальное видео, делает аудио-транскрипт, отправляет видео в Qwen через OpenRouter для визуального сценария, подтягивает YouTube JSON и сохраняет артефакты в `outputs/` и `.system/`.

## Быстрый старт

```bash
cp .env.example .env
npm test
npm run analyze -- --video ./fixtures/sample.mp4 --youtube-id VIDEO_ID
```

Для реального визуального анализа нужен `OPENROUTER_API_KEY`. Для локальной транскрибации нужен `ffmpeg`, `ffprobe`, `whisper-cli` и путь к модели в `VIDEO_ANALYTICS_WHISPER_MODEL`. Вместо локального Whisper можно указать `VIDEO_ANALYTICS_TRANSCRIBER=openrouter-stt`.

Для YouTube Data API нужен `YOUTUBE_API_KEY`. YouTube Analytics использует OAuth:

```bash
npm run youtube:auth
```

Если ключи не настроены, CLI не падает: он пишет JSON со статусом `skipped_*`.

Секреты хранятся только в `.env` и `.system/youtube-oauth-token.json`. Эти файлы игнорируются Git и не должны попадать в публичный репозиторий.

Важно: визуальный анализ отправляет исходное видео или сжатый preview в OpenRouter/Qwen. Не используйте этот режим для чувствительных видео без согласия владельца данных. Для приватного запуска можно оставить `OPENROUTER_API_KEY` пустым: транскрипт и YouTube JSON будут созданы, а визуальный анализ будет помечен как `skipped_missing_openrouter_key`.

## Входы

Одиночный запуск:

```bash
npm run analyze -- --video "/path/to/video.mp4" --youtube-url "https://youtu.be/VIDEO_ID"
```

Пакетный запуск:

```bash
cp inputs/videos.example.jsonl inputs/videos.jsonl
npm run analyze -- --input inputs/videos.jsonl
```

`inputs/videos.jsonl` is a local ignored manifest. Use `inputs/videos.example.jsonl` as a sanitized template:

```jsonl
{"video_path":"/path/to/video.mp4","youtube_url":"https://youtu.be/VIDEO_ID","title":"03 - Планирование дня"}
{"video_path":"/path/to/video2.mov","youtube_id":"VIDEO_ID_2"}
```

## Выходы

Для каждого видео создаётся:

```text
outputs/<safe-video-stem>/
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
  youtube.data-api.json
  youtube.analytics-api.json
```

`outputs/` и `.system/` считаются локальными рабочими артефактами и по умолчанию не коммитятся.

Финальный отчёт по публикации не генерируется отдельной CLI-командой. Агент читает транскрипт, визуальный сценарий, `YOUTUBE_<id>.json` и `RUN_<run_id>.json`, затем сохраняет отчёт в `outputs/reports/YOUTUBE_REPORT_<id>.md` по инструкции из `SKILL.md`.
