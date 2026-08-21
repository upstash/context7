# Context7 Plugin for DeepSeek Harness

The official [Context7](https://context7.com) plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It adds native `resolve-library-id` and `query-docs` tools so the harness can retrieve current library documentation and code examples. It also adds invocation guidance to the system prompt so library-specific questions use Context7 automatically.

## Installation

Install the plugin and store a Context7 API key in DeepSeek Harness's credential provider:

```bash
npx ctx7@latest setup --deepseek headless
```

Pass another profile name instead of `headless` when needed. Without an existing Context7 login, setup opens the device authorization flow and creates an API key. To install the bundle without configuring authentication:

```bash
dsh plugin --profile headless add @upstash/context7-deepseek-harness
```

Verify the composed configuration and start the profile:

```bash
dsh --profile headless --dump-config
dsh --profile headless
```

To remove it:

```bash
dsh plugin --profile headless remove @upstash/context7-deepseek-harness
```

## Authentication

The plugin works without authentication using Context7's anonymous rate limits. For higher limits, it resolves `CONTEXT7_API_KEY` through DeepSeek Harness's credential provider before every request, so credential updates apply without reloading the plugin.

The setup command stores the key in `$DSH_HOME/.credentials.yaml`, which defaults to `~/.dsh/.credentials.yaml`. You can also provide it through the environment:

```bash
export CONTEXT7_API_KEY="your-api-key"
```

For manual credential-file setup, edit the flat YAML mapping and apply owner-only permissions:

```bash
mkdir -p ~/.dsh
chmod 700 ~/.dsh
${EDITOR:-vi} ~/.dsh/.credentials.yaml
chmod 600 ~/.dsh/.credentials.yaml
```

```yaml
CONTEXT7_API_KEY: your-api-key
```

Do not put API keys in `cordis.yml` or `cordis.patch.yml`; composed configuration can be printed and shared during debugging.

## Tools

- `resolve-library-id` finds Context7-compatible library IDs and available versions.
- `query-docs` retrieves documentation for a selected library ID and question.

## License

MIT
