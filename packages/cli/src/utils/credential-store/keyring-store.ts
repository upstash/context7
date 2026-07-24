import type { CredentialStore, TokenData } from "./types.js";
import { normalizeTokenData } from "./json-store.js";

export const KEYRING_SERVICE = "context7-cli";
export const KEYRING_ACCOUNT = "default";

type KeytarModule = typeof import("keytar");

let keytarModule: KeytarModule | null | undefined;

async function loadKeytar(): Promise<KeytarModule | null> {
  if (keytarModule !== undefined) {
    return keytarModule;
  }
  try {
    keytarModule = await import("keytar");
    return keytarModule;
  } catch {
    keytarModule = null;
    return null;
  }
}

export async function isKeyringAvailable(): Promise<boolean> {
  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }
  try {
    await keytar.findPassword(KEYRING_SERVICE);
    return true;
  } catch {
    return false;
  }
}

export class KeyringCredentialStore implements CredentialStore {
  readonly backend = "keyring" as const;

  async load(): Promise<TokenData | null> {
    const keytar = await loadKeytar();
    if (!keytar) {
      return null;
    }
    try {
      const payload = await keytar.getPassword(KEYRING_SERVICE, KEYRING_ACCOUNT);
      if (!payload) {
        return null;
      }
      return JSON.parse(payload) as TokenData;
    } catch {
      return null;
    }
  }

  async save(tokens: TokenData): Promise<void> {
    const keytar = await loadKeytar();
    if (!keytar) {
      throw new Error("System keyring is not available on this machine.");
    }
    await keytar.setPassword(
      KEYRING_SERVICE,
      KEYRING_ACCOUNT,
      JSON.stringify(normalizeTokenData(tokens))
    );
  }

  async clear(): Promise<boolean> {
    const keytar = await loadKeytar();
    if (!keytar) {
      return false;
    }
    try {
      return await keytar.deletePassword(KEYRING_SERVICE, KEYRING_ACCOUNT);
    } catch {
      return false;
    }
  }
}

/** Test hook to reset the lazy keytar import cache. */
export function resetKeytarCacheForTests(): void {
  keytarModule = undefined;
}
