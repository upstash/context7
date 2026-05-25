import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveLibraryIdTool } from "../lib/tools/resolve-library-id";
import { queryDocsTool } from "../lib/tools/query-docs";

function context7(pi: ExtensionAPI): void {
  pi.registerTool(resolveLibraryIdTool);
  pi.registerTool(queryDocsTool);
}

export default context7;
