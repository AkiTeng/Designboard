import type {
  WorkspaceDialogPort,
  WorkspaceDirectorySelection,
} from '../HostBridge'

export type TauriWorkspaceDialogPortInput = {
  openWorkspaceDirectory(): Promise<string | null>
}

export class TauriDialogPort implements WorkspaceDialogPort {
  constructor(private readonly input: TauriWorkspaceDialogPortInput) {}

  async openWorkspaceDirectory(): Promise<WorkspaceDirectorySelection | null> {
    const path = await this.input.openWorkspaceDirectory()

    if (!path) {
      return null
    }

    return { path }
  }
}
