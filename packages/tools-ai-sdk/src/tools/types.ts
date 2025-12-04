/**
 * Configuration for Context7 tools
 */
export interface Context7ToolsConfig {
  /**
   * Context7 API key. If not provided, will use CONTEXT7_API_KEY environment variable.
   */
  apiKey?: string;
  /**
   * Default maximum number of documentation results per page.
   * @default 10
   */
  defaultMaxResults?: number;
}
