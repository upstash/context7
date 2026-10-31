---
"ctx7": patch
---

Tell users on a prerelease when the release is out. The update check compared versions by their numeric core alone, so a `canary` snapshot such as `0.9.0-canary-20261006104237` looked identical to the `0.9.0` release cut from it, and no update notice ever appeared. Versions are now ordered the way semver orders them: a release outranks any prerelease of the same core, prerelease identifiers are compared per the spec (numeric below alphanumeric, more identifiers above fewer), and build metadata is ignored.
