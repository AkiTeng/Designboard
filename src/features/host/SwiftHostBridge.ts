import type { WorkspaceRepository } from '../projects/storage/types'
import type {
  HostBridge,
  HostCapabilities,
  WorkspaceDialogPort,
  WorkspaceDirectorySelection,
} from './HostBridge'

type SwiftHostBridgeInput = {
  workspaceRepositoryFactory: () => WorkspaceRepository
  dialogPort: WorkspaceDialogPort
}

export class SwiftHostBridge implements HostBridge {
  readonly platform = 'swift-wkwebview'
  readonly capabilities: HostCapabilities = {
    workspaceDialogs: true,
    nativeMenus: true,
    nativeWindowControls: true,
  }

  constructor(private readonly input: SwiftHostBridgeInput) {}

  createWorkspaceRepository(): WorkspaceRepository {
    return this.input.workspaceRepositoryFactory()
  }

  async openWorkspaceDirectory(): Promise<WorkspaceDirectorySelection | null> {
    return this.input.dialogPort.openWorkspaceDirectory()
  }
}
