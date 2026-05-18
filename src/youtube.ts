import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDirectory, fileExists, readJsonFile } from "./fs.ts";
import type {
  JsonValue,
  YouTubeAnalyticsArgs,
  YouTubeAnalyticsBundle,
  YouTubeAnalyticsResult,
  YouTubeBundleArgs,
  YouTubeBundleResult,
  YouTubeDataArgs,
  YouTubeDataResult,
  YouTubeRequestStatus,
  YouTubeSubResult,
  VideoAnalyticsConfig
} from "./types.ts";

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const THUMBNAIL_CTR_STATUS = "unsupported_by_youtube_analytics_api" as const;
const TRAFFIC_DETAIL_SOURCE_TYPES = [
  "YT_SEARCH",
  "RELATED_VIDEO",
  "EXT_URL",
  "SUBSCRIBER",
  "YT_CHANNEL",
  "YT_OTHER_PAGE",
  "HASHTAGS",
  "SOUND_PAGE"
] as const;
const YOUTUBE_ANALYTICS_SCOPE = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly"
].join(" ");

interface OAuthToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
  [key: string]: unknown;
}

export function extractYouTubeId(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (YOUTUBE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") {
    return null;
  }

  const watchId = url.searchParams.get("v");
  if (watchId && YOUTUBE_ID_PATTERN.test(watchId)) {
    return watchId;
  }
  const [kind, id] = url.pathname.split("/").filter(Boolean);
  if ((kind === "shorts" || kind === "embed") && id && YOUTUBE_ID_PATTERN.test(id)) {
    return id;
  }
  return null;
}

export async function fetchYouTubeBundle(args: YouTubeBundleArgs): Promise<YouTubeBundleResult> {
  if (!args.youtubeId) {
    return buildSkippedBundle(null, "skipped_missing_youtube_id");
  }

  const video = args.apiKey
    ? await safeYouTubeDataApiRequest("videos", {
        id: args.youtubeId,
        part: "snippet,contentDetails,statistics,status,topicDetails,player,recordingDetails,localizations"
      }, args.apiKey)
    : skippedSubResult("skipped_missing_api_key");

  const channelId = getFirstItem(video.data)?.snippet?.channelId;
  const publishedAt = getFirstItem(video.data)?.snippet?.publishedAt;
  const startDate = typeof publishedAt === "string" ? publishedAt.slice(0, 10) : args.startDate;

  const channel =
    args.apiKey && typeof channelId === "string"
      ? await safeYouTubeDataApiRequest("channels", {
          id: channelId,
          part: "snippet,contentDetails,statistics,status,brandingSettings,topicDetails"
        }, args.apiKey)
      : skippedSubResult(args.apiKey ? "skipped_missing_channel_id" : "skipped_missing_api_key");

  const uploadsPlaylist = getFirstItem(channel.data)?.contentDetails?.relatedPlaylists?.uploads;
  const latestUploads =
    args.apiKey && typeof uploadsPlaylist === "string" && uploadsPlaylist
      ? await safeYouTubeDataApiRequest("playlistItems", {
          playlistId: uploadsPlaylist,
          part: "snippet,contentDetails,status",
          maxResults: "5"
        }, args.apiKey)
      : skippedSubResult(args.apiKey ? "skipped_missing_uploads_playlist" : "skipped_missing_api_key");

  const comments = args.apiKey
    ? await safeYouTubeDataApiRequest("commentThreads", {
        videoId: args.youtubeId,
        part: "snippet,replies",
        maxResults: "20",
        order: "relevance",
        textFormat: "plainText"
      }, args.apiKey)
    : skippedSubResult("skipped_missing_api_key");

  const captions = args.apiKey
    ? await safeYouTubeDataApiRequest("captions", {
        videoId: args.youtubeId,
        part: "snippet"
      }, args.apiKey)
    : skippedSubResult("skipped_missing_api_key");

  const analytics = await fetchAnalyticsBundle({ ...args, startDate });
  const dataApiStatus = deriveDataApiStatus(video.status);
  const analyticsApiStatus = deriveAnalyticsApiStatus(analytics.status);

  return {
    youtube_id: args.youtubeId,
    data_api_status: dataApiStatus,
    analytics_api_status: analyticsApiStatus,
    thumbnail_ctr_status: THUMBNAIL_CTR_STATUS,
    statuses: {
      video: video.status,
      channel: channel.status,
      latest_uploads: latestUploads.status,
      comments: comments.status,
      captions: captions.status,
      analytics: analytics.status,
      analytics_summary: analytics.summary.status,
      analytics_daily: analytics.daily.status,
      analytics_retention: analytics.retention.status,
      analytics_traffic_sources: analytics.traffic_sources.status,
      analytics_traffic_details: analytics.traffic_details.status,
      analytics_subscribed_status: analytics.subscribed_status.status,
      analytics_geography: analytics.geography.status,
      analytics_devices: analytics.devices.status,
      analytics_demographics: analytics.demographics.status,
      analytics_engagement: analytics.engagement.status,
      channel_benchmark: analytics.channel_benchmark.status,
      thumbnail_ctr: THUMBNAIL_CTR_STATUS
    },
    video,
    channel,
    latest_uploads: latestUploads,
    comments,
    captions,
    analytics,
    channel_benchmark: analytics.channel_benchmark,
    data_api: video.data,
    analytics_api: analytics.summary.data
  };
}

export async function fetchYouTubeData(args: YouTubeDataArgs): Promise<YouTubeDataResult> {
  const bundle = await fetchYouTubeBundle({
    root: process.cwd(),
    youtubeId: args.youtubeId,
    apiKey: args.apiKey,
    startDate: "2005-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    oauthClientId: "",
    oauthClientSecret: ""
  });
  return {
    youtube_id: bundle.youtube_id,
    data_api_status: bundle.data_api_status,
    data_api: bundle.data_api
  };
}

export async function fetchYouTubeAnalytics(args: YouTubeAnalyticsArgs): Promise<YouTubeAnalyticsResult> {
  const analytics = await fetchAnalyticsBundle(args);
  return {
    analytics_api_status: deriveAnalyticsApiStatus(analytics.status),
    analytics_api: analytics.summary.data
  };
}

export async function youtubeDataApiRequest(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string
): Promise<JsonValue> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", apiKey);
  const response = await fetch(url);
  const body = (await response.json()) as JsonValue;
  if (!response.ok) {
    throw new Error(`YouTube Data API ${endpoint} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function youtubeAnalyticsRequest(
  params: Record<string, string>,
  token: OAuthToken
): Promise<JsonValue> {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const body = (await response.json()) as JsonValue;
  if (!response.ok) {
    throw new Error(`YouTube Analytics API failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export function buildRetentionAnalyticsParams(args: {
  youtubeId: string;
  startDate: string;
  endDate: string;
}): Record<string, string> {
  return {
    ids: "channel==MINE",
    startDate: args.startDate,
    endDate: args.endDate,
    metrics:
      "audienceWatchRatio,relativeRetentionPerformance,startedWatching,stoppedWatching,totalSegmentImpressions",
    dimensions: "elapsedVideoTimeRatio",
    filters: `video==${args.youtubeId}`,
    sort: "elapsedVideoTimeRatio"
  };
}

export function buildTrafficSourcesAnalyticsParams(args: {
  youtubeId: string;
  startDate: string;
  endDate: string;
}): Record<string, string> {
  return {
    ids: "channel==MINE",
    startDate: args.startDate,
    endDate: args.endDate,
    metrics: "engagedViews,views,estimatedMinutesWatched",
    dimensions: "insightTrafficSourceType",
    filters: `video==${args.youtubeId}`,
    sort: "-views"
  };
}

export function buildTrafficDetailAnalyticsParams(args: {
  youtubeId: string;
  startDate: string;
  endDate: string;
  sourceType: string;
}): Record<string, string> {
  return {
    ids: "channel==MINE",
    startDate: args.startDate,
    endDate: args.endDate,
    metrics: "engagedViews,views,estimatedMinutesWatched",
    dimensions: "insightTrafficSourceDetail",
    filters: `video==${args.youtubeId};insightTrafficSourceType==${args.sourceType}`,
    sort: "-views",
    maxResults: "25"
  };
}

export function buildChannelBenchmarkAnalyticsParams(args: {
  startDate: string;
  endDate: string;
}): Record<string, string> {
  return {
    ids: "channel==MINE",
    startDate: args.startDate,
    endDate: args.endDate,
    metrics:
      "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,subscribersGained",
    dimensions: "video",
    sort: "-views",
    maxResults: "10"
  };
}

async function fetchAnalyticsBundle(args: YouTubeAnalyticsArgs): Promise<YouTubeAnalyticsBundle> {
  if (!args.youtubeId) {
    return buildSkippedAnalyticsBundle("skipped_missing_youtube_id");
  }
  if (!args.oauthClientId || !args.oauthClientSecret) {
    return buildSkippedAnalyticsBundle("skipped_missing_oauth");
  }

  const tokenPath = args.tokenPath ?? path.join(args.root, ".system", "youtube-oauth-token.json");
  if (!(await fileExists(tokenPath))) {
    return buildSkippedAnalyticsBundle("skipped_missing_oauth_token");
  }

  const token = await readValidAccessToken(tokenPath, args.oauthClientId, args.oauthClientSecret);
  if (!token.access_token) {
    return buildSkippedAnalyticsBundle("skipped_missing_oauth_token");
  }

  const summary = await safeYouTubeAnalyticsRequest(
    {
      ids: "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: [
        "views",
        "estimatedMinutesWatched",
        "averageViewDuration",
        "averageViewPercentage",
        "likes",
        "comments",
        "subscribersGained",
        "subscribersLost"
      ].join(","),
      filters: `video==${args.youtubeId}`
    },
    token
  );
  const daily = await safeYouTubeAnalyticsRequest(
    {
      ids: "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
      dimensions: "day",
      filters: `video==${args.youtubeId}`,
      sort: "day"
    },
    token
  );
  const retention = await safeYouTubeAnalyticsRequest(
    buildRetentionAnalyticsParams({
      youtubeId: args.youtubeId,
      startDate: args.startDate,
      endDate: args.endDate
    }),
    token
  );
  const trafficSources = await safeYouTubeAnalyticsRequest(
    buildTrafficSourcesAnalyticsParams({
      youtubeId: args.youtubeId,
      startDate: args.startDate,
      endDate: args.endDate
    }),
    token
  );
  const trafficDetails = await fetchTrafficDetails(args, token);
  const subscribedStatus = await safeYouTubeAnalyticsRequest(
    {
      ids: "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: "engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
      dimensions: "subscribedStatus",
      filters: `video==${args.youtubeId}`,
      sort: "-views"
    },
    token
  );
  const geography = await safeYouTubeAnalyticsRequest(
    {
      ids: "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: "engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
      dimensions: "country",
      filters: `video==${args.youtubeId}`,
      sort: "-views",
      maxResults: "25"
    },
    token
  );
  const devices = await safeYouTubeAnalyticsRequest(
    {
      ids: "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: "engagedViews,views,estimatedMinutesWatched",
      dimensions: "deviceType",
      filters: `video==${args.youtubeId}`,
      sort: "-views"
    },
    token
  );
  const demographics = await safeYouTubeAnalyticsRequest(
    {
      ids: "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: "viewerPercentage",
      dimensions: "ageGroup,gender",
      filters: `video==${args.youtubeId}`
    },
    token
  );
  const engagement = await safeYouTubeAnalyticsRequest(
    {
      ids: "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: [
        "engagedViews",
        "views",
        "likes",
        "comments",
        "shares",
        "videosAddedToPlaylists",
        "videosRemovedFromPlaylists",
        "subscribersGained",
        "subscribersLost"
      ].join(","),
      filters: `video==${args.youtubeId}`
    },
    token
  );
  const channelBenchmark = await safeYouTubeAnalyticsRequest(
    buildChannelBenchmarkAnalyticsParams({
      startDate: args.startDate,
      endDate: args.endDate
    }),
    token
  );

  return {
    status: deriveAggregateAnalyticsStatus([
      summary,
      daily,
      retention,
      trafficSources,
      trafficDetails,
      subscribedStatus,
      geography,
      devices,
      demographics,
      engagement,
      channelBenchmark
    ]),
    summary,
    daily,
    retention,
    traffic_sources: trafficSources,
    traffic_details: trafficDetails,
    subscribed_status: subscribedStatus,
    geography,
    devices,
    demographics,
    engagement,
    channel_benchmark: channelBenchmark,
    thumbnail_ctr_status: THUMBNAIL_CTR_STATUS
  };
}

async function fetchTrafficDetails(
  args: YouTubeAnalyticsArgs & { youtubeId: string },
  token: OAuthToken
): Promise<YouTubeSubResult> {
  const results: Record<string, YouTubeSubResult> = {};
  for (const sourceType of TRAFFIC_DETAIL_SOURCE_TYPES) {
    results[sourceType] = await safeYouTubeAnalyticsRequest(
      buildTrafficDetailAnalyticsParams({
        youtubeId: args.youtubeId,
        startDate: args.startDate,
        endDate: args.endDate,
        sourceType
      }),
      token
    );
  }
  const subResults = Object.values(results);
  return {
    status: deriveAggregateAnalyticsStatus(subResults),
    data: {
      source_types: [...TRAFFIC_DETAIL_SOURCE_TYPES],
      results
    }
  };
}

async function safeYouTubeDataApiRequest(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string
): Promise<YouTubeSubResult> {
  try {
    return { status: "completed", data: await youtubeDataApiRequest(endpoint, params, apiKey) };
  } catch (error) {
    return failedSubResult(error);
  }
}

async function safeYouTubeAnalyticsRequest(
  params: Record<string, string>,
  token: OAuthToken
): Promise<YouTubeSubResult> {
  try {
    const data = await youtubeAnalyticsRequest(params, token);
    return analyticsHasRows(data)
      ? { status: "completed", data }
      : { status: "skipped_not_owner_or_no_rows", data };
  } catch (error) {
    return failedSubResult(error);
  }
}

function buildSkippedBundle(
  youtubeId: string | null,
  status: YouTubeRequestStatus
): YouTubeBundleResult {
  const video = skippedSubResult(status);
  const channel = skippedSubResult(status);
  const latestUploads = skippedSubResult(status);
  const comments = skippedSubResult(status);
  const captions = skippedSubResult(status);
  const analytics = buildSkippedAnalyticsBundle(status);
  return {
    youtube_id: youtubeId,
    data_api_status: deriveDataApiStatus(status),
    analytics_api_status: deriveAnalyticsApiStatus(status),
    thumbnail_ctr_status: THUMBNAIL_CTR_STATUS,
    statuses: {
      video: video.status,
      channel: channel.status,
      latest_uploads: latestUploads.status,
      comments: comments.status,
      captions: captions.status,
      analytics: analytics.status,
      analytics_summary: analytics.summary.status,
      analytics_daily: analytics.daily.status,
      analytics_retention: analytics.retention.status,
      analytics_traffic_sources: analytics.traffic_sources.status,
      analytics_traffic_details: analytics.traffic_details.status,
      analytics_subscribed_status: analytics.subscribed_status.status,
      analytics_geography: analytics.geography.status,
      analytics_devices: analytics.devices.status,
      analytics_demographics: analytics.demographics.status,
      analytics_engagement: analytics.engagement.status,
      channel_benchmark: analytics.channel_benchmark.status,
      thumbnail_ctr: THUMBNAIL_CTR_STATUS
    },
    video,
    channel,
    latest_uploads: latestUploads,
    comments,
    captions,
    analytics,
    channel_benchmark: analytics.channel_benchmark,
    data_api: video.data,
    analytics_api: analytics.summary.data
  };
}

function buildSkippedAnalyticsBundle(status: YouTubeRequestStatus): YouTubeAnalyticsBundle {
  const skipped = skippedSubResult(status);
  return {
    status,
    summary: skipped,
    daily: skipped,
    retention: skipped,
    traffic_sources: skipped,
    traffic_details: skipped,
    subscribed_status: skipped,
    geography: skipped,
    devices: skipped,
    demographics: skipped,
    engagement: skipped,
    channel_benchmark: skipped,
    thumbnail_ctr_status: THUMBNAIL_CTR_STATUS
  };
}

function skippedSubResult(status: YouTubeRequestStatus): YouTubeSubResult {
  return { status, data: { status } };
}

function failedSubResult(error: unknown): YouTubeSubResult {
  return {
    status: "failed",
    data: { status: "failed", error: errorToString(error) },
    error: errorToString(error)
  };
}

function deriveDataApiStatus(status: YouTubeRequestStatus): YouTubeDataResult["data_api_status"] {
  if (status === "completed") {
    return "completed";
  }
  if (status === "skipped_missing_youtube_id") {
    return "skipped_missing_youtube_id";
  }
  if (status === "skipped_missing_api_key") {
    return "skipped_missing_api_key";
  }
  return "failed" as YouTubeDataResult["data_api_status"];
}

function deriveAnalyticsApiStatus(
  status: YouTubeRequestStatus
): YouTubeAnalyticsResult["analytics_api_status"] {
  if (status === "completed") {
    return "completed";
  }
  if (status === "skipped_missing_youtube_id") {
    return "skipped_missing_youtube_id";
  }
  if (status === "skipped_missing_oauth") {
    return "skipped_missing_oauth";
  }
  if (status === "skipped_missing_oauth_token") {
    return "skipped_missing_oauth_token";
  }
  return "failed" as YouTubeAnalyticsResult["analytics_api_status"];
}

function deriveAggregateAnalyticsStatus(results: YouTubeSubResult[]): YouTubeRequestStatus {
  if (results.some((result) => result.status === "completed")) {
    return "completed";
  }
  if (results.every((result) => result.status === "skipped_not_owner_or_no_rows")) {
    return "skipped_not_owner_or_no_rows";
  }
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }
  return results[0]?.status ?? "failed";
}

function analyticsHasRows(data: JsonValue): boolean {
  const rows = (data as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) && rows.length > 0;
}

function getFirstItem(data: JsonValue): Record<string, any> | null {
  const items = (data as { items?: unknown[] })?.items;
  const first = items?.[0];
  return first && typeof first === "object" ? (first as Record<string, any>) : null;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runYouTubeAuth(config: VideoAnalyticsConfig): Promise<void> {
  if (!config.googleOAuthClientId || !config.googleOAuthClientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required for youtube:auth.");
  }

  const port = 53682;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const code = await waitForOAuthCode(port, redirectUri, config.googleOAuthClientId);
  const token = await exchangeAuthorizationCode({
    code,
    redirectUri,
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret
  });
  await writeOAuthTokenFile(config.youtubeOAuthTokenPath, token);
  console.log(`Saved YouTube OAuth token to ${config.youtubeOAuthTokenPath}`);
}

async function waitForOAuthCode(port: number, redirectUri: string, clientId: string): Promise<string> {
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", YOUTUBE_ANALYTICS_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("Open this URL to authorize YouTube Analytics access:");
  console.log(authUrl.toString());

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", redirectUri);
        if (requestUrl.pathname !== "/oauth2callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) {
          response.writeHead(400).end("Missing code");
          reject(new Error("OAuth callback did not include a code."));
          server.close();
          return;
        }
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Authorization complete. You can close this browser tab.");
        resolve(code);
        server.close();
      } catch (error) {
        reject(error);
        server.close();
      }
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeAuthorizationCode(args: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<OAuthToken> {
  const params = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const body = (await response.json()) as OAuthToken;
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return withExpiryDate(body);
}

async function readValidAccessToken(
  tokenPath: string,
  clientId: string,
  clientSecret: string
): Promise<OAuthToken> {
  const token = await readJsonFile<OAuthToken>(tokenPath);
  if (token.access_token && token.expiry_date && token.expiry_date > Date.now() + 60_000) {
    return token;
  }
  if (!token.refresh_token) {
    return token;
  }
  const refreshed = await refreshAccessToken(token.refresh_token, clientId, clientSecret);
  const merged = { ...token, ...refreshed, refresh_token: token.refresh_token };
  await writeOAuthTokenFile(tokenPath, merged);
  return merged;
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<OAuthToken> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const body = (await response.json()) as OAuthToken;
  if (!response.ok) {
    throw new Error(`OAuth token refresh failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return withExpiryDate(body);
}

function withExpiryDate(token: OAuthToken): OAuthToken {
  if (typeof token.expires_in === "number") {
    return { ...token, expiry_date: Date.now() + token.expires_in * 1000 };
  }
  return token;
}

async function writeOAuthTokenFile(tokenPath: string, token: OAuthToken): Promise<void> {
  await ensureDirectory(path.dirname(tokenPath));
  await fs.writeFile(tokenPath, `${JSON.stringify(token, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.chmod(tokenPath, 0o600);
}
