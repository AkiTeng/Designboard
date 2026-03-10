export interface FileSystemAdapter {
  ensureDir(path: string): Promise<void>
  readTextFile(path: string): Promise<string>
  writeTextFile(path: string, content: string): Promise<void>
}
