# Context7 Plugin for DeepSeek Harness

The official [Context7](https://context7.com) plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It adds native `resolve-library-id` and `query-docs` tools so the harness can retrieve current library documentation and code examples.

## Installation

```bash
dsh plugin --profile my-profile add @upstash/context7-deepseek-harness
```

The bundle adds the Context7 plugin to the selected profile. Verify the composed configuration and start the profile:

```bash
dsh --profile my-profile --dump-config
dsh --profile my-profile
```

To remove it:

```bash
dsh plugin --profile my-profile remove @upstash/context7-deepseek-harness
```

## Authentication

The plugin works without configuration using Context7's anonymous rate limits. For higher limits, create an API key in the [Context7 dashboard](https://context7.com/dashboard) and set it before launching the harness:

```bash
export CONTEXT7_API_KEY="your-api-key"
```

You can also configure the key when loading the plugin directly in `cordis.yml`:

```yaml
- name: "@upstash/context7-deepseek-harness"
  config:
    apiKey: "your-api-key"
```

## Tools

- `resolve-library-id` finds Context7-compatible library IDs and available versions.
- `query-docs` retrieves documentation for a selected library ID and question.

## License

MIT
