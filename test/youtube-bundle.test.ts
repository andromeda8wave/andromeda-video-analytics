import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRetentionAnalyticsParams,
  fetchYouTubeBundle,
  THUMBNAIL_CTR_STATUS
} from "../src/youtube.ts";

test("fetchYouTubeBundle skips every section without a YouTube id", async () => {
  const result = await fetchYouTubeBundle({
    root: await mkdtemp(path.join(os.tmpdir(), "video-analytics-")),
    youtubeId: null,
    apiKey: "test-key",
    startDate: "2026-05-01",
    endDate: "2026-05-16",
    oauthClientId: "client",
    oauthClientSecret: "secret"
  });

  assert.equal(result.youtube_id, null);
  assert.equal(result.video.status, "skipped_missing_youtube_id");
  assert.equal(result.channel.status, "skipped_missing_youtube_id");
  assert.equal(result.comments.status, "skipped_missing_youtube_id");
  assert.equal(result.analytics.status, "skipped_missing_youtube_id");
});

test("fetchYouTubeBundle does not call YouTube Data API without an API key", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch should not be called without an API key");
  };

  try {
    const result = await fetchYouTubeBundle({
      root: await mkdtemp(path.join(os.tmpdir(), "video-analytics-")),
      youtubeId: "dQw4w9WgXcQ",
      apiKey: "",
      startDate: "2026-05-01",
      endDate: "2026-05-16",
      oauthClientId: "",
      oauthClientSecret: ""
    });

    assert.equal(calls, 0);
    assert.equal(result.video.status, "skipped_missing_api_key");
    assert.equal(result.analytics.status, "skipped_missing_oauth");
    assert.equal(result.thumbnail_ctr_status, THUMBNAIL_CTR_STATUS);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchYouTubeBundle returns public sections and skips analytics without OAuth", async () => {
  const originalFetch = globalThis.fetch;
  const requested = new Set<string>();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").at(-1)!;
    requested.add(endpoint);

    const bodies: Record<string, unknown> = {
      videos: {
        items: [
          {
            id: "dQw4w9WgXcQ",
            snippet: {
              title: "Video",
              channelId: "UC123",
              channelTitle: "Channel",
              publishedAt: "2026-05-01T00:00:00Z"
            },
            statistics: { viewCount: "10" },
            contentDetails: { duration: "PT1M" }
          }
        ]
      },
      channels: {
        items: [
          {
            id: "UC123",
            snippet: { title: "Channel" },
            statistics: { subscriberCount: "5" },
            contentDetails: { relatedPlaylists: { uploads: "UU123" } }
          }
        ]
      },
      playlistItems: { items: [{ contentDetails: { videoId: "next" }, snippet: { title: "Next" } }] },
      commentThreads: { items: [{ snippet: { topLevelComment: { snippet: { textDisplay: "Nice" } } } }] },
      captions: { items: [{ id: "caption-1", snippet: { language: "ru" } }] }
    };

    return new Response(JSON.stringify(bodies[endpoint]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const result = await fetchYouTubeBundle({
      root: await mkdtemp(path.join(os.tmpdir(), "video-analytics-")),
      youtubeId: "dQw4w9WgXcQ",
      apiKey: "test-key",
      startDate: "2026-05-01",
      endDate: "2026-05-16",
      oauthClientId: "",
      oauthClientSecret: ""
    });

    assert.deepEqual([...requested].sort(), [
      "captions",
      "channels",
      "commentThreads",
      "playlistItems",
      "videos"
    ]);
    assert.equal(result.video.status, "completed");
    assert.equal(result.channel.status, "completed");
    assert.equal(result.latest_uploads.status, "completed");
    assert.equal(result.comments.status, "completed");
    assert.equal(result.captions.status, "completed");
    assert.equal(result.analytics.status, "skipped_missing_oauth");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildRetentionAnalyticsParams uses one video filter and supported metrics", () => {
  const params = buildRetentionAnalyticsParams({
    youtubeId: "8VZARvzXcRs",
    startDate: "2026-05-04",
    endDate: "2026-05-16"
  });

  assert.equal(params.filters, "video==8VZARvzXcRs");
  assert.equal(params.dimensions, "elapsedVideoTimeRatio");
  assert.equal(
    params.metrics,
    "audienceWatchRatio,relativeRetentionPerformance,startedWatching,stoppedWatching,totalSegmentImpressions"
  );
  assert.equal(params.sort, "elapsedVideoTimeRatio");
});
