import type { Readable } from 'node:stream';
import * as yauzl from 'yauzl';

/**
 * Promise wrappers around yauzl's callback API. yauzl parses the central
 * directory and streams entries lazily from a file handle, so memory stays
 * flat regardless of archive size.
 */

export function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zipfile) =>
      err ? reject(err) : resolve(zipfile),
    );
  });
}

/**
 * Iterates entries sequentially, awaiting `fn` before reading the next one.
 * Closes the zipfile when done or on failure.
 */
export async function forEachZipEntry(
  zipfile: yauzl.ZipFile,
  fn: (entry: yauzl.Entry) => Promise<void>,
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('entry', (entry: yauzl.Entry) => {
        fn(entry).then(() => zipfile.readEntry(), reject);
      });
      zipfile.on('end', () => resolve());
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}

export function openZipEntryStream(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) =>
      err ? reject(err) : resolve(stream),
    );
  });
}

export function isDirectoryEntry(entry: yauzl.Entry): boolean {
  return entry.fileName.endsWith('/');
}

/** macOS resource forks, dotfiles, and anything with a `..` path segment. */
export function junkReason(fileName: string): string | null {
  const segments = fileName.split('/');
  if (segments.includes('..')) return 'unsafe path';
  if (segments[0] === '__MACOSX') return 'macOS metadata';
  const base = segments[segments.length - 1];
  if (base.startsWith('.')) return 'hidden file';
  return null;
}
