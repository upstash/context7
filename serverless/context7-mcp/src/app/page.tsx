export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8 md:p-12 space-y-8 md:space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Context7 Serverless MCP
        </h1>
        <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
          A minimal HTTP Model Context Protocol server that lets your editor fetch up-to-date,
          version-specific documentation and code examples from Context7. Learn more at
          <a
            className="ml-1 text-blue-600 hover:underline"
            href="https://context7.com"
            target="_blank"
            rel="noreferrer"
          >
            context7.com
          </a>
          .
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 md:p-6 space-y-3 bg-white/50 dark:bg-black/20">
        <div className="flex items-baseline gap-2">
          <span className="text-sm uppercase tracking-wide text-neutral-500">Endpoint</span>
          <code className="text-sm rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5">
            /mcp
          </code>
        </div>
        <div>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Quick test using MCP Inspector:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 text-sm">
            <code>npx -y @modelcontextprotocol/inspector http://localhost:3000/mcp</code>
          </pre>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 md:p-6 space-y-3 bg-white/50 dark:bg-black/20">
        <h2 className="text-lg font-medium">Authentication</h2>
        <p className="text-neutral-600 dark:text-neutral-300">
          Provide your API key with this header:
        </p>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 text-sm">
          <code>Context7-API-Key: YOUR_API_KEY</code>
        </pre>
      </section>
    </main>
  );
}
