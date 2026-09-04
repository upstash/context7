import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs } from "ai";
import { describe, expect, test } from "vitest";
import { Context7Agent } from "./index";

const minimaxEndpoints = [
  {
    region: "global_en",
    baseURL: "https://api.minimax.io/v1",
  },
  {
    region: "cn_zh",
    baseURL: "https://api.minimaxi.com/v1",
  },
] as const;

const minimaxModelIds = ["MiniMax-M3", "MiniMax-M2.7"] as const;

describe("MiniMax OpenAI-compatible provider fixture", () => {
  for (const endpoint of minimaxEndpoints) {
    for (const modelId of minimaxModelIds) {
      test(`${endpoint.region} ${modelId} runs through Context7Agent`, async () => {
        const requests: Array<{
          url: string;
          body: Record<string, unknown>;
        }> = [];

        const fetchMock: typeof fetch = async (input, init) => {
          const body = JSON.parse(init?.body as string) as Record<string, unknown>;
          requests.push({ url: String(input), body });

          return new Response(
            JSON.stringify({
              id: "fixture-response",
              object: "chat.completion",
              created: 0,
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "fixture response",
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            {
              headers: { "content-type": "application/json" },
            }
          );
        };

        const provider = createOpenAI({
          apiKey: "fixture-key",
          baseURL: endpoint.baseURL,
          fetch: fetchMock,
        });
        const agent = new Context7Agent({
          model: provider.chat(modelId),
          stopWhen: stepCountIs(1),
        });

        const result = await agent.generate({ prompt: "Reply with a short answer." });

        expect(result.text).toBe("fixture response");
        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toBe(`${endpoint.baseURL}/chat/completions`);
        expect(requests[0]?.body.model).toBe(modelId);
        expect(requests[0]?.body.tools).toBeDefined();
      });
    }
  }
});
