import { extractAssistantText, validateOpenRouterModelSupportsVideo } from "./openrouter.ts";
import { prepareVideoDataUrl } from "./video.ts";
import type { JsonValue, VisualAnalysisArgs, VisualAnalysisResult } from "./types.ts";

export interface OpenRouterVideoContentPart {
  type: "video_url";
  video_url: { url: string };
}

export const VISUAL_ANALYSIS_PROMPT = [
  "/no_think",
  "Опиши визуальный ряд как сценарий для видеоаналитики.",
  "Нужны: сцены и примерные таймкоды, экранный текст/OCR, действия в кадре, монтаж, объекты, экраны, визуальные слабые места и что усилить.",
  "Пиши структурировано по-русски. Если точные таймкоды недоступны, укажи приблизительные интервалы."
].join("\n");

export async function analyzeVideoWithQwen(args: VisualAnalysisArgs): Promise<VisualAnalysisResult> {
  if (!args.config.openRouterApiKey) {
    return {
      status: "skipped_missing_openrouter_key",
      model: args.config.qwenModel,
      prompt: VISUAL_ANALYSIS_PROMPT,
      content: "Визуальный анализ пропущен: не задан OPENROUTER_API_KEY.",
      request: { status: "skipped_missing_openrouter_key", model: args.config.qwenModel },
      response: { status: "skipped_missing_openrouter_key" }
    };
  }

  await validateOpenRouterModelSupportsVideo(args.config.qwenModel, args.config);
  const video = await prepareVideoDataUrl(args.videoPath, args.systemDir, args.config);
  const request = {
    model: args.config.qwenModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISUAL_ANALYSIS_PROMPT },
          buildVideoContentPart(video.dataUrl)
        ]
      }
    ],
    temperature: 0.2,
    reasoning: { exclude: true },
    stream: false
  };
  const requestForLog = {
    ...request,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISUAL_ANALYSIS_PROMPT },
          {
            type: "video_url",
            video_url: {
              url: redactDataUrl(video.dataUrl),
              source_path: video.sourcePath,
              mime_type: video.mimeType,
              compressed: video.compressed,
              original_byte_size: args.fingerprint.byte_size
            }
          }
        ]
      }
    ]
  };

  const response = await fetch(`${args.config.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Video Analytics MVP"
    },
    body: JSON.stringify(request)
  });
  const body = (await response.json()) as JsonValue;
  if (!response.ok) {
    return {
      status: "failed_request",
      model: args.config.qwenModel,
      prompt: VISUAL_ANALYSIS_PROMPT,
      content: `OpenRouter/Qwen request failed with HTTP ${response.status}.`,
      request: requestForLog as JsonValue,
      response: body
    };
  }

  return {
    status: "completed",
    model: args.config.qwenModel,
    prompt: VISUAL_ANALYSIS_PROMPT,
    content: extractAssistantText(body) || "Модель не вернула текстовый визуальный сценарий.",
    request: requestForLog as JsonValue,
    response: body
  };
}

export function buildVideoContentPart(dataUrl: string): OpenRouterVideoContentPart {
  return { type: "video_url", video_url: { url: dataUrl } };
}

function redactDataUrl(value: string): string {
  const [header] = value.split(",", 1);
  return `${header},<base64 redacted>`;
}
