import type { FileSystemAdapter } from './fs-adapter'

export class InMemoryFileSystemAdapter implements FileSystemAdapter {
  private readonly directories = new Set<string>()
  private readonly files = new Map<string, string>()

  async ensureDir(path: string): Promise<void> {
    this.directories.add(path)
  }

  async readTextFile(path: string): Promise<string> {
    const content = this.files.get(path)

    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }

    return content
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  snapshot() {
    return {
      directories: [...this.directories],
      files: Object.fromEntries(this.files),
    }
  }
}
