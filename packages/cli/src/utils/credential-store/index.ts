import pc from "picocolors";
import { JsonCredentialStore, jsonCredentialsExist } from "./json-store.js";
import { isKeyringAvailable, KeyringCredentialStore } from "./keyring-store.js";
import type { CredentialStore, CredentialStoreMode } from "./types.js";

export type { CredentialStore, CredentialStoreMode, TokenData } from "./types.js";
export { JsonCredentialStore, jsonCredentialsExist, normalizeTokenData } from "./json-store.js";
export {
  isKeyringAvailable,
  KeyringCredentialStore,
  KEYRING_ACCOUNT,
  KEYRING_SERVICE,
  resetKeytarCacheForTests,
} from "./keyring-store.js";

let cachedStore: CredentialStore | null = null;
let migrationDone = false;
let migrationNotified = false;

function getConfiguredMode(): CredentialStoreMode {
  const value = process.env.CTX7_CREDENTIAL_STORE?.trim().toLowerCase();
  if (value === "json" || value === "keyring" || value === "auto") {
    return value;
  }
  return "auto";
}

function notifyMigration(): void {
  if (migrationNotified) {
    return;
  }
  migrationNotified = true;
  if (process.stderr.isTTY) {
    process.stderr.write(`${pc.dim("Migrated credentials to system keyring.")}\n`);
  }
}

async function migrateJsonToKeyring(store: KeyringCredentialStore): Promise<void> {
  if (!jsonCredentialsExist()) {
    return;
  }

  const jsonStore = new JsonCredentialStore();
  const tokens = await jsonStore.load();
  if (!tokens) {
    await jsonStore.clear();
    return;
  }

  const existing = await store.load();
  if (!existing) {
    await store.save(tokens);
    notifyMigration();
  }

  await jsonStore.clear();
}

async function createStore(mode: CredentialStoreMode): Promise<CredentialStore> {
  if (mode === "json") {
    return new JsonCredentialStore();
  }

  const keyringAvailable = await isKeyringAvailable();
  if (mode === "keyring") {
    if (!keyringAvailable) {
      throw new Error(
        "CTX7_CREDENTIAL_STORE=keyring was set, but the system keyring is not available."
      );
    }
    return new KeyringCredentialStore();
  }

  if (keyringAvailable) {
    return new KeyringCredentialStore();
  }
  return new JsonCredentialStore();
}

export async function resolveCredentialStore(): Promise<CredentialStore> {
  if (cachedStore) {
    return cachedStore;
  }

  const store = await createStore(getConfiguredMode());
  if (store.backend === "keyring" && !migrationDone) {
    migrationDone = true;
    await migrateJsonToKeyring(store as KeyringCredentialStore);
  }

  cachedStore = store;
  return store;
}

/** Test hook to reset cached store selection and migration state. */
export function resetCredentialStoreForTests(): void {
  cachedStore = null;
  migrationDone = false;
  migrationNotified = false;
}
