import type {
  RawTranscriptArtifact,
  VisualAnalysisResult,
  YouTubeCombinedResult
} from "./types.ts";

export function renderTranscriptMarkdown(args: {
  title: string;
  videoPath: string;
  youtubeId: string | null;
  runId: string;
  transcript: RawTranscriptArtifact;
}): string {
  const segments = args.transcript.segments.length
    ? args.transcript.segments
        .map(
          (segment) =>
            `**${formatTimecode(segment.start_ms)} - ${formatTimecode(segment.end_ms)}** ${segment.text}`
        )
        .join("\n\n")
    : "_Сегменты не обнаружены. Проверьте качество аудио или язык транскрибации._";

  return [
    `# ТРАНСКРИПТ: ${args.title}`,
    "",
    "## Metadata",
    "",
    `- Run ID: \`${args.runId}\``,
    `- Video: \`${args.videoPath}\``,
    `- YouTube ID: \`${args.youtubeId ?? "none"}\``,
    `- Language: \`${args.transcript.language}\``,
    `- ASR model: \`${args.transcript.model_id}\``,
    `- Generated at: \`${args.transcript.generated_at}\``,
    "",
    "## Сегменты",
    "",
    segments,
    ""
  ].join("\n");
}

export function renderVisualScenarioMarkdown(args: {
  title: string;
  videoPath: string;
  youtubeId: string | null;
  runId: string;
  visual: VisualAnalysisResult;
  youtube: YouTubeCombinedResult;
}): string {
  return [
    `# ВИЗУАЛЬНЫЙ СЦЕНАРИЙ: ${args.title}`,
    "",
    "## Metadata",
    "",
    `- Run ID: \`${args.runId}\``,
    `- Video: \`${args.videoPath}\``,
    `- YouTube ID: \`${args.youtubeId ?? "none"}\``,
    `- Qwen model: \`${args.visual.model}\``,
    `- Visual status: \`${args.visual.status}\``,
    `- YouTube Data API: \`${args.youtube.data_api_status}\``,
    `- Analytics: \`${args.youtube.analytics_api_status}\``,
    "",
    "## YouTube Summary",
    "",
    renderYouTubeSummary(args.youtube),
    "",
    "## Визуальный таймлайн",
    "",
    args.visual.content.trim() || "_Визуальный сценарий пуст._",
    "",
    "## Экранный текст / OCR",
    "",
    "См. OCR и экранные элементы в ответе модели выше. В следующих версиях это можно вынести в структурированный JSON.",
    "",
    "## Монтажные наблюдения",
    "",
    "См. наблюдения о монтаже в ответе модели выше.",
    "",
    "## Рекомендации",
    "",
    "См. рекомендации в ответе модели выше.",
    ""
  ].join("\n");
}

export function formatTimecode(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${String(millis).padStart(3, "0")}`;
}

function renderYouTubeSummary(youtube: YouTubeCombinedResult): string {
  if ("video" in youtube && youtube.video && typeof youtube.video === "object") {
    return renderYouTubeBundleSummary(youtube as YouTubeCombinedResult & Record<string, any>);
  }

  const item = readFirstYouTubeItem(youtube.data_api);
  if (!item) {
    return [
      `- YouTube ID: \`${youtube.youtube_id ?? "none"}\``,
      `- Data API status: \`${youtube.data_api_status}\``,
      `- Analytics status: \`${youtube.analytics_api_status}\``
    ].join("\n");
  }
  const snippet = item.snippet ?? {};
  const statistics = item.statistics ?? {};
  return [
    `- Название: ${readValue(snippet.title)}`,
    `- Канал: ${readValue(snippet.channelTitle)}`,
    `- Опубликовано: \`${readValue(snippet.publishedAt)}\``,
    `- Просмотры: \`${readValue(statistics.viewCount)}\``,
    `- Лайки: \`${readValue(statistics.likeCount)}\``,
    `- Комментарии: \`${readValue(statistics.commentCount)}\``,
    `- Analytics status: \`${youtube.analytics_api_status}\``
  ].join("\n");
}

function renderYouTubeBundleSummary(youtube: YouTubeCombinedResult & Record<string, any>): string {
  const videoItem = readFirstYouTubeItem(youtube.video?.data) ?? readFirstYouTubeItem(youtube.data_api);
  const channelItem = readFirstYouTubeItem(youtube.channel?.data);
  const snippet = videoItem?.snippet ?? {};
  const statistics = videoItem?.statistics ?? {};
  const channelStatistics = channelItem?.statistics ?? {};
  const latestUploadsCount = readItems(youtube.latest_uploads?.data).length;
  const commentsCount = readItems(youtube.comments?.data).length;
  const summaryRow = readRows(youtube.analytics?.summary?.data)[0] ?? [];
  const retentionRows = readRows(youtube.analytics?.retention?.data);

  return [
    `- Название: ${readValue(snippet.title)}`,
    `- Канал: ${readValue(snippet.channelTitle ?? channelItem?.snippet?.title)}`,
    `- Опубликовано: \`${readValue(snippet.publishedAt)}\``,
    `- Просмотры: \`${readValue(statistics.viewCount)}\``,
    `- Лайки: \`${readValue(statistics.likeCount)}\``,
    `- Комментарии: \`${readValue(statistics.commentCount)}\``,
    `- Подписчики канала: \`${readValue(channelStatistics.subscriberCount)}\``,
    `- Последних загрузок в JSON: \`${latestUploadsCount}\``,
    `- Топ-комментариев в JSON: \`${commentsCount}\``,
    `- Analytics status: \`${youtube.analytics_api_status}\``,
    `- Analytics summary: ${renderAnalyticsSummary(summaryRow)}`,
    `- Retention: ${renderRetentionInsight(retentionRows)}`
  ].join("\n");
}

function readFirstYouTubeItem(data: unknown): Record<string, Record<string, unknown>> | null {
  const items = (data as { items?: unknown[] })?.items;
  const first = items?.[0];
  return first && typeof first === "object" ? (first as Record<string, Record<string, unknown>>) : null;
}

function readItems(data: unknown): unknown[] {
  const items = (data as { items?: unknown[] })?.items;
  return Array.isArray(items) ? items : [];
}

function readRows(data: unknown): unknown[][] {
  const rows = (data as { rows?: unknown[][] })?.rows;
  return Array.isArray(rows) ? rows : [];
}

function renderAnalyticsSummary(row: unknown[]): string {
  if (row.length === 0) {
    return "`no rows`";
  }
  const [views, minutes, averageDuration, averagePercentage, likes, comments, gained] = row;
  return [
    `views \`${readValue(views)}\``,
    `watch min \`${readValue(minutes)}\``,
    `avg sec \`${readValue(averageDuration)}\``,
    `avg % \`${readValue(averagePercentage)}\``,
    `likes \`${readValue(likes)}\``,
    `comments \`${readValue(comments)}\``,
    `subs gained \`${readValue(gained)}\``
  ].join(", ");
}

function renderRetentionInsight(rows: unknown[][]): string {
  if (rows.length === 0) {
    return "`no rows`";
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  return [
    `${rows.length} points`,
    `start watch ratio \`${readValue(first?.[1])}\``,
    `end watch ratio \`${readValue(last?.[1])}\``
  ].join(", ");
}

function readValue(value: unknown): string {
  if (typeof value === "string" && value) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "n/a";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
