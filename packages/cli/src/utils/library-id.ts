/**
 * Recover a library ID that Git Bash mangled on Windows.
 *
 * Git Bash rewrites a leading-slash argument like "/facebook/react" into a
 * Windows path under the Git install dir, e.g. "C:/Program Files/Git/facebook/react".
 * We undo that so the "/owner/repo" format still works.
 */
export function recoverLibraryId(input: string): string {
  // "//owner/repo" is the Git Bash escape that skips conversion; collapse it.
  if (input.startsWith("//")) return input.replace(/^\/+/, "/");

  // Normal library ID, nothing to recover.
  if (input.startsWith("/")) return input;

  // Only a drive-letter path (e.g. "C:/...") can be a mangled ID.
  if (!/^[A-Za-z]:[\\/]/.test(input)) return input;

  // Strip the Git install dir, keeping the "/owner/repo[/version]" tail.
  const normalized = input.replace(/\\/g, "/");
  const match = normalized.match(/^[A-Za-z]:\/.*?\/(?:Git|PortableGit|git-bash)\/(.+)$/i);
  return match ? `/${match[1]}` : input;
}
