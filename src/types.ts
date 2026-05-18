export const GENERATED_BY = "video-analytics";
export const PIPELINE_VERSION = "mvp-0.1.0";
export const OUTPUTS_DIR = "outputs";
export const SYSTEM_DIR = ".system";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface VideoInputRecord {
  video_path: string;
  youtube_url?: string;
  youtube_id?: string;
  title?: string;
  language?: string;
}

export interface NormalizedVideoInput extends VideoInputRecord {
  video_path: string;
  youtube_id?: string;
  title: string;
  language: string;
}

export type TranscriberKind = "local-whisper" | "openrouter-stt";

export interface VideoAnalyticsConfig {
  root: string;
  openRouterApiKey: string;
  openRouterBaseUrl: string;
  qwenModel: string;
  transcriber: TranscriberKind;
  openRouterSttModel: string;
  whisperBin: string;
  whisperModel: string;
  ffmpegBin: string;
  ffprobeBin: string;
  youtubeApiKey: string;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  youtubeOAuthTokenPath: string;
  maxDirectVideoBytes: number;
  previewMaxHeight: number;
  language: string;
}

export interface FileFingerprint {
  content_sha256: string;
  byte_size: number;
  mtime_ms: number;
}

export interface FfprobeInfo {
  duration_ms: number;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  raw: JsonValue;
}

export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence?: number;
}

export interface RawTranscriptArtifact {
  schema_version: "1.0.0";
  source_id: string;
  original_filename: string;
  language: string;
  model_id: string;
  generated_at: string;
  segments: TranscriptSegment[];
  provenance: {
    audio_path: string;
    generated_by: string;
    normalization: {
      runtime: "ffmpeg";
      binary: string;
      args: string[];
    };
    asr: {
      runtime: "whisper.cpp" | "openrouter-stt" | "test";
      binary: string;
      model: string;
      args: string[];
    };
  };
}

export interface VisualAnalysisResult {
  status:
    | "completed"
    | "skipped_missing_openrouter_key"
    | "failed_model_capability"
    | "failed_request";
  model: string;
  prompt: string;
  content: string;
  request: JsonValue;
  response: JsonValue;
}

export interface YouTubeDataResult {
  youtube_id: string | null;
  data_api_status: "completed" | "skipped_missing_api_key" | "skipped_missing_youtube_id";
  data_api: JsonValue;
}

export interface YouTubeAnalyticsResult {
  analytics_api_status:
    | "completed"
    | "skipped_missing_oauth"
    | "skipped_missing_youtube_id"
    | "skipped_missing_oauth_token";
  analytics_api: JsonValue;
}

export interface YouTubeCombinedResult extends YouTubeDataResult, YouTubeAnalyticsResult {}

export type YouTubeRequestStatus =
  | "completed"
  | "skipped_missing_youtube_id"
  | "skipped_missing_api_key"
  | "skipped_missing_oauth"
  | "skipped_missing_oauth_token"
  | "skipped_missing_channel_id"
  | "skipped_missing_uploads_playlist"
  | "skipped_not_owner_or_no_rows"
  | "unsupported_by_youtube_analytics_api"
  | "failed";

export interface YouTubeSubResult {
  status: YouTubeRequestStatus;
  data: JsonValue;
  error?: string;
}

export interface YouTubeAnalyticsBundle {
  status: YouTubeRequestStatus;
  summary: YouTubeSubResult;
  daily: YouTubeSubResult;
  retention: YouTubeSubResult;
  traffic_sources: YouTubeSubResult;
  traffic_details: YouTubeSubResult;
  subscribed_status: YouTubeSubResult;
  geography: YouTubeSubResult;
  devices: YouTubeSubResult;
  demographics: YouTubeSubResult;
  engagement: YouTubeSubResult;
  channel_benchmark: YouTubeSubResult;
  thumbnail_ctr_status: "unsupported_by_youtube_analytics_api";
}

export interface YouTubeBundleResult extends YouTubeCombinedResult {
  thumbnail_ctr_status: "unsupported_by_youtube_analytics_api";
  statuses: Record<string, YouTubeRequestStatus>;
  video: YouTubeSubResult;
  channel: YouTubeSubResult;
  latest_uploads: YouTubeSubResult;
  comments: YouTubeSubResult;
  captions: YouTubeSubResult;
  analytics: YouTubeAnalyticsBundle;
  channel_benchmark: YouTubeSubResult;
}

export interface OpenRouterModelInfo {
  id: string;
  architecture?: {
    input_modalities?: string[];
    [key: string]: JsonValue | undefined;
  };
  [key: string]: JsonValue | undefined;
}

export interface PipelineRunManifest {
  schema_version: "1.0.0";
  run_id: string;
  generated_at: string;
  input: NormalizedVideoInput;
  fingerprint: FileFingerprint;
  ffprobe: FfprobeInfo;
  statuses: {
    transcript: string;
    visual_analysis: string;
    youtube_data_api: string;
    youtube_analytics_api: string;
  };
  artifacts: Record<string, string>;
}

export interface PipelineRunResult extends PipelineRunManifest {
  output_dir: string;
  system_dir: string;
}

export interface PipelineResult {
  runs: PipelineRunResult[];
}

export interface PipelineDependencies {
  now: () => Date;
  randomId: () => string;
  probeVideo: (videoPath: string, config: VideoAnalyticsConfig) => Promise<FfprobeInfo>;
  extractAudio: (videoPath: string, audioPath: string, config: VideoAnalyticsConfig) => Promise<void>;
  transcribe: (args: TranscriptionArgs) => Promise<RawTranscriptArtifact>;
  analyzeVisuals: (args: VisualAnalysisArgs) => Promise<VisualAnalysisResult>;
  fetchYouTubeData: (args: YouTubeDataArgs) => Promise<YouTubeDataResult>;
  fetchYouTubeAnalytics: (args: YouTubeAnalyticsArgs) => Promise<YouTubeAnalyticsResult>;
  fetchYouTubeBundle: (args: YouTubeBundleArgs) => Promise<YouTubeBundleResult>;
}

export interface TranscriptionArgs {
  audioPath: string;
  videoPath: string;
  input: NormalizedVideoInput;
  ffprobe: FfprobeInfo;
  config: VideoAnalyticsConfig;
  runId: string;
}

export interface VisualAnalysisArgs {
  videoPath: string;
  systemDir: string;
  input: NormalizedVideoInput;
  ffprobe: FfprobeInfo;
  fingerprint: FileFingerprint;
  config: VideoAnalyticsConfig;
}

export interface YouTubeDataArgs {
  youtubeId: string | null;
  apiKey: string;
}

export interface YouTubeAnalyticsArgs {
  root: string;
  youtubeId: string | null;
  startDate: string;
  endDate: string;
  oauthClientId: string;
  oauthClientSecret: string;
  tokenPath?: string;
}

export interface YouTubeBundleArgs extends YouTubeAnalyticsArgs {
  apiKey: string;
}
