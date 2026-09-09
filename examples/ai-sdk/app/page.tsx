"use client";

import { type FormEvent, useState } from "react";

const EXAMPLE_PROMPT = "How do I revalidate a route in the latest Next.js?";

export default function Home() {
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setAnswer("");
    setError("");

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response.json()) as { text?: string; error?: string };

      if (!response.ok || !data.text) {
        throw new Error(data.error ?? "The agent could not answer the question.");
      }
      setAnswer(data.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section>
        <p className="eyebrow">Context7 + Vercel AI SDK</p>
        <h1>Ask with current docs</h1>
        <p className="intro">
          This agent looks up the relevant library in Context7 before answering your question.
        </p>

        <form onSubmit={submit}>
          <label htmlFor="prompt">Library question</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Looking up docs..." : "Ask Context7 Agent"}
          </button>
        </form>

        {error && <p className="error">{error}</p>}
        {answer && <pre>{answer}</pre>}
      </section>
    </main>
  );
}
