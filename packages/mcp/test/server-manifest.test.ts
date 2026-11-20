import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// server.json is the server card published to the MCP registry, which is the
// entry VS Code lists under Customizations > Browse. Browse installs a card only
// when one of its transport choices can be taken as it stands: no secret input,
// and no required input without a default. A card whose every choice declares a
// secret is refused with "This MCP server requires an installation choice or
// additional values that Browse cannot collect yet." Keeping one secret-free
// choice here is what keeps the gallery entry installable.

interface DeclaredInput {
  name?: string;
  isSecret?: boolean;
  isRequired?: boolean;
  default?: string;
  variables?: Record<string, DeclaredInput>;
}

interface RemoteEntry {
  type: string;
  url: string;
  headers?: DeclaredInput[];
  variables?: Record<string, DeclaredInput>;
}

interface PackageEntry {
  registryType?: string;
  identifier: string;
  environmentVariables?: DeclaredInput[];
  runtimeArguments?: DeclaredInput[];
  packageArguments?: DeclaredInput[];
}

interface ServerCard {
  packages?: PackageEntry[];
  remotes?: RemoteEntry[];
}

const card = JSON.parse(
  readFileSync(new URL("../../../server.json", import.meta.url), "utf-8")
) as ServerCard;

/** Whether installing this choice would make the client ask for a value first. */
function collectsValue(inputs: DeclaredInput[]): boolean {
  return inputs.some(
    (input) =>
      input.isSecret === true ||
      (input.isRequired === true && input.default === undefined) ||
      collectsValue(Object.values(input.variables ?? {}))
  );
}

const choices = [
  ...(card.remotes ?? []).map((remote) => ({
    where: `remote ${remote.url}`,
    collects: collectsValue([...(remote.headers ?? []), ...Object.values(remote.variables ?? {})]),
  })),
  ...(card.packages ?? []).map((pkg) => ({
    where: `package ${pkg.identifier}`,
    collects: collectsValue([
      ...(pkg.environmentVariables ?? []),
      ...(pkg.runtimeArguments ?? []),
      ...(pkg.packageArguments ?? []),
    ]),
  })),
];

describe("server.json", () => {
  test("offers a transport choice Browse can install without collecting a value", () => {
    const installable = choices.filter((choice) => !choice.collects).map((choice) => choice.where);

    expect(installable).not.toHaveLength(0);
  });

  test("keeps the API key path for the clients that can collect a secret", () => {
    const keyedRemote = (card.remotes ?? []).find((remote) =>
      (remote.headers ?? []).some(
        (header) => header.name === "Authorization" && header.isSecret === true
      )
    );
    const keyedPackage = (card.packages ?? []).find((pkg) =>
      (pkg.environmentVariables ?? []).some(
        (variable) => variable.name === "CONTEXT7_API_KEY" && variable.isSecret === true
      )
    );

    expect(keyedRemote?.url).toBe("https://mcp.context7.com/mcp");
    expect(keyedPackage).toBeDefined();
  });
});
