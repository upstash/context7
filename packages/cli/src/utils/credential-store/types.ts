export interface TokenData {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
}

export type CredentialBackend = "keyring" | "json";

export type CredentialStoreMode = "auto" | "json" | "keyring";

export interface CredentialStore {
  readonly backend: CredentialBackend;
  load(): Promise<TokenData | null>;
  save(tokens: TokenData): Promise<void>;
  clear(): Promise<boolean>;
}
