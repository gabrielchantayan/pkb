import { createHash } from 'crypto';
import { writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';

const STORAGE_PATH = process.env.STORAGE_PATH || './data/attachments';

export interface SaveFileResult {
  relative_path: string;
  full_path: string;
}

/**
 * Save a buffer to storage with content-addressable path
 * Returns the relative path for storing in database
 */
export async function save_file(buffer: Buffer, original_filename: string): Promise<string> {
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const date = new Date();
  const ext = path.extname(original_filename) || '';

  const relative_path = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${hash}${ext}`;
  const full_path = path.join(STORAGE_PATH, relative_path);

  await mkdir(path.dirname(full_path), { recursive: true });
  await writeFile(full_path, buffer);

  return relative_path;
}

/**
 * Delete a file from storage
 */
export async function delete_file(relative_path: string): Promise<void> {
  const full_path = path.join(STORAGE_PATH, relative_path);
  try {
    await unlink(full_path);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Get the full filesystem path for a stored file
 */
export function get_file_path(relative_path: string): string {
  return path.join(STORAGE_PATH, relative_path);
}

/**
 * Get the base storage path
 */
export function get_storage_path(): string {
  return STORAGE_PATH;
}
