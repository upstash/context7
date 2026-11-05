---
"ctx7": patch
---

Keep your comments when `ctx7 setup` or `ctx7 remove` touches an MCP config. `.vscode/mcp.json` and `.cursor/mcp.json` are JSONC, and the CLI accepted them for reading but wrote them back through `JSON.stringify`, so every comment and any layout you kept in the file was silently dropped. The Context7 entry is now added or removed with an in-place edit that leaves the rest of the file alone, comments included. A file the edit cannot handle safely, such as one whose trailing comma would be stranded, is still rewritten whole as before.
