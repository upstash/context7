import pkg from "../../package.json" with { type: "json" };

export const SERVER_VERSION: string = pkg.version;
