import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { join } from "path";

import {
  getCacheDir,
  getConfigDir,
  getCredentialsFilePath,
  getPreviewsDir,
  getStateDir,
  getUpdateStateFilePath,
} from "../utils/storage-paths.js";

const HOME = "/fake-home";

beforeEach(() => {
  // os.homedir() reads $HOME first on POSIX, so stubbing the env var pins the
  // home directory deterministically without mocking the `os` builtin (which
  // resolves unreliably across Node versions / worker pooling in CI).
  vi.stubEnv("HOME", HOME);
  vi.stubEnv("XDG_CONFIG_HOME", undefined);
  vi.stubEnv("XDG_STATE_HOME", undefined);
  vi.stubEnv("XDG_CACHE_HOME", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("XDG defaults", () => {
  test("config dir defaults to ~/.config/context7", () => {
    expect(getConfigDir()).toBe(join(HOME, ".config", "context7"));
    expect(getCredentialsFilePath()).toBe(join(HOME, ".config", "context7", "credentials.json"));
  });

  test("state dir defaults to ~/.local/state/context7", () => {
    expect(getStateDir()).toBe(join(HOME, ".local", "state", "context7"));
    expect(getUpdateStateFilePath()).toBe(
      join(HOME, ".local", "state", "context7", "cli-state.json")
    );
  });

  test("cache dir defaults to ~/.cache/context7 and previews live under it", () => {
    expect(getCacheDir()).toBe(join(HOME, ".cache", "context7"));
    expect(getPreviewsDir()).toBe(join(HOME, ".cache", "context7", "previews"));
  });
});

describe("XDG overrides", () => {
  test("honors XDG_CONFIG_HOME, XDG_STATE_HOME, and XDG_CACHE_HOME", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/cfg");
    vi.stubEnv("XDG_STATE_HOME", "/state");
    vi.stubEnv("XDG_CACHE_HOME", "/cache");

    expect(getConfigDir()).toBe(join("/cfg", "context7"));
    expect(getStateDir()).toBe(join("/state", "context7"));
    expect(getCacheDir()).toBe(join("/cache", "context7"));
    expect(getPreviewsDir()).toBe(join("/cache", "context7", "previews"));
  });

  test("ignores empty XDG values and uses the default", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(getConfigDir()).toBe(join(HOME, ".config", "context7"));
  });

  test("ignores relative XDG values per the spec and uses the default", () => {
    vi.stubEnv("XDG_STATE_HOME", "relative/path");
    expect(getStateDir()).toBe(join(HOME, ".local", "state", "context7"));
  });
});
