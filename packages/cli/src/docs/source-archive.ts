import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import tar from "tar-stream";

const SKIPPED_ENTRIES = new Set([".docs7", ".git", "node_modules"]);

type SourceFile = { readonly absolutePath: string; readonly name: string };

async function sourceFiles(rootDir: string): Promise<ReadonlyArray<SourceFile>> {
  const files: SourceFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (
        SKIPPED_ENTRIES.has(entry.name) ||
        (entry.name.startsWith(".") && entry.name !== ".mintignore")
      ) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("The documentation source contains a symbolic link");
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile())
        throw new Error("The documentation source contains an unsupported file type");
      files.push({
        absolutePath,
        name: path.relative(rootDir, absolutePath).split(path.sep).join("/"),
      });
    }
  };
  await visit(rootDir);
  return files;
}

/** Create a gzip-compressed archive of one local documentation source directory. */
export async function createSourceArchive(sourceDir: string, archivePath: string): Promise<void> {
  const files = await sourceFiles(sourceDir);
  const pack = tar.pack();
  const output = pipeline(
    pack,
    createGzip({ level: 6 }),
    fs.createWriteStream(archivePath, { flags: "wx", mode: 0o600 })
  );
  try {
    for (const file of files) {
      const stat = await fsp.stat(file.absolutePath);
      await pipeline(
        fs.createReadStream(file.absolutePath),
        pack.entry({
          name: file.name,
          type: "file",
          size: stat.size,
          mode: stat.mode & 0o777,
          mtime: stat.mtime,
        })
      );
    }
    pack.finalize();
    await output;
  } catch (error) {
    pack.destroy(error instanceof Error ? error : undefined);
    await output.catch(() => undefined);
    throw error;
  }
}
