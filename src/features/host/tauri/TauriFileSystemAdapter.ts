import type { FileSystemAdapter } from '../../projects/storage/fs-adapter'

export type TauriFileSystemPort = {
  ensureDir(path: string): Promise<void>
  readTextFile(path: string): Promise<string>
  writeTextFile(path: string, content: string): Promise<void>
}

export class TauriFileSystemAdapter implements FileSystemAdapter {
  constructor(private readonly port: TauriFileSystemPort) {}

  async ensureDir(path: string): Promise<void> {
    return this.port.ensureDir(path)
  }

  async readTextFile(path: string): Promise<string> {
    return this.port.readTextFile(path)
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    return this.port.writeTextFile(path, content)
  }
}
