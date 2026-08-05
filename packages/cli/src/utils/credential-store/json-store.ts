import * as fs from "fs";
import {
  CREDENTIALS_FILE_NAME,
  getConfigDir,
  getCredentialsFilePath,
  getLegacyFilePath,
  migrateLegacyFileSync,
  resolveReadPathSync,
} from "../storage-paths.js";
import type { CredentialStore, TokenData } from "./types.js";

const CREDENTIALS_MODE = 0o600;

function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

export function normalizeTokenData(tokens: TokenData): TokenData {
  return {
    ...tokens,
    expires_at:
      tokens.expires_at ?? (tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined),
  };
}

export function jsonCredentialsExist(): boolean {
  const credentialsFile = resolveReadPathSync(
    CREDENTIALS_FILE_NAME,
    getCredentialsFilePath(),
    CREDENTIALS_MODE
  );
  if (fs.existsSync(credentialsFile)) {
    return true;
  }
  return fs.existsSync(getLegacyFilePath(CREDENTIALS_FILE_NAME));
}

export class JsonCredentialStore implements CredentialStore {
  readonly backend = "json" as const;

  async load(): Promise<TokenData | null> {
    const credentialsFile = resolveReadPathSync(
      CREDENTIALS_FILE_NAME,
      getCredentialsFilePath(),
      CREDENTIALS_MODE
    );
    if (!fs.existsSync(credentialsFile)) {
      return null;
    }
    try {
      const data = JSON.parse(fs.readFileSync(credentialsFile, "utf-8"));
      return data as TokenData;
    } catch {
      return null;
    }
  }

  async save(tokens: TokenData): Promise<void> {
    const credentialsFile = getCredentialsFilePath();
    migrateLegacyFileSync(CREDENTIALS_FILE_NAME, credentialsFile, CREDENTIALS_MODE);
    ensureConfigDir();
    const data = normalizeTokenData(tokens);
    fs.writeFileSync(credentialsFile, JSON.stringify(data, null, 2), { mode: CREDENTIALS_MODE });
    fs.chmodSync(credentialsFile, CREDENTIALS_MODE);
  }

  async clear(): Promise<boolean> {
    const credentialsFile = getCredentialsFilePath();
    let removed = false;
    if (fs.existsSync(credentialsFile)) {
      fs.unlinkSync(credentialsFile);
      removed = true;
    }
    const legacyCredentialsFile = getLegacyFilePath(CREDENTIALS_FILE_NAME);
    if (fs.existsSync(legacyCredentialsFile)) {
      fs.unlinkSync(legacyCredentialsFile);
      removed = true;
    }
    return removed;
  }
}
