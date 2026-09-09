import { agent } from "../../../lib/agent";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return Response.json({ error: "Prompt is required." }, { status: 400 });
  }

  try {
    const result = await agent.generate({ prompt });
    return Response.json({ text: result.text });
  } catch (cause) {
    console.error(cause);
    return Response.json({ error: "The agent could not answer the question." }, { status: 500 });
  }
}
