export type Mode = "code" | "info";

export type ContextRequest = {
  query: string;
  topic?: string;
  library?: string;
  mode?: Mode;
};

export type ContextResponse = {
  data: string;
};
