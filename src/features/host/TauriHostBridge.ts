import type { WorkspaceRepository } from '../projects/storage/types'
import type {
  HostBridge,
  HostCapabilities,
  WorkspaceDialogPort,
  WorkspaceDirectorySelection,
} from './HostBridge'

type TauriHostBridgeInput = {
  workspaceRepositoryFactory: () => WorkspaceRepository
  dialogPort: WorkspaceDialogPort
}

export class TauriHostBridge implements HostBridge {
  readonly platform = 'tauri'
  readonly capabilities: HostCapabilities = {
    workspaceDialogs: true,
    nativeMenus: true,
    nativeWindowControls: true,
  }

  constructor(private readonly input: TauriHostBridgeInput) {}

  createWorkspaceRepository(): WorkspaceRepository {
    return this.input.workspaceRepositoryFactory()
  }

  async openWorkspaceDirectory(): Promise<WorkspaceDirectorySelection | null> {
    return this.input.dialogPort.openWorkspaceDirectory()
  }
}
