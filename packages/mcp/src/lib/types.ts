export type ContextRequest = {
  query: string;
  topic?: string;
  library?: string;
  mode?: "code" | "info";
};

export type ContextResponse = {
  data: string;
};
