import type { OpenRouterModelInfo, VideoAnalyticsConfig } from "./types.ts";

export function assertModelSupportsVideo(model: OpenRouterModelInfo): void {
  const modalities = model.architecture?.input_modalities ?? [];
  if (!modalities.includes("video")) {
    throw new Error(
      `OpenRouter model "${model.id}" does not support video input. input_modalities=${JSON.stringify(modalities)}`
    );
  }
}

export async function validateOpenRouterModelSupportsVideo(
  modelId: string,
  config: VideoAnalyticsConfig
): Promise<OpenRouterModelInfo> {
  const response = await fetch(`${config.openRouterBaseUrl}/models`, {
    headers: config.openRouterApiKey
      ? { Authorization: `Bearer ${config.openRouterApiKey}` }
      : undefined
  });
  const body = (await response.json()) as { data?: OpenRouterModelInfo[]; [key: string]: unknown };
  if (!response.ok) {
    throw new Error(`OpenRouter models request failed (${response.status}): ${JSON.stringify(body)}`);
  }
  const model = (body.data ?? []).find((item) => item.id === modelId || item.canonical_slug === modelId);
  if (!model) {
    throw new Error(`OpenRouter model "${modelId}" was not found in /api/v1/models.`);
  }
  assertModelSupportsVideo(model);
  return model;
}

export function extractAssistantText(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}
