import { BrowserWorkspaceRepository } from '../projects/storage/BrowserWorkspaceRepository'
import type { WorkspaceRepository } from '../projects/storage/types'

export type HostPlatform = 'browser' | 'tauri' | 'swift-wkwebview'

export type HostCapabilities = {
  workspaceDialogs: boolean
  nativeMenus: boolean
  nativeWindowControls: boolean
}

export type WorkspaceDirectorySelection = {
  path: string
}

export interface WorkspaceDialogPort {
  openWorkspaceDirectory(): Promise<WorkspaceDirectorySelection | null>
}

export interface HostBridge {
  platform: HostPlatform
  capabilities: HostCapabilities
  createWorkspaceRepository(): WorkspaceRepository
  openWorkspaceDirectory(): Promise<WorkspaceDirectorySelection | null>
}

export class BrowserHostBridge implements HostBridge {
  readonly platform = 'browser'
  readonly capabilities: HostCapabilities = {
    workspaceDialogs: false,
    nativeMenus: false,
    nativeWindowControls: false,
  }

  createWorkspaceRepository(): WorkspaceRepository {
    return new BrowserWorkspaceRepository()
  }

  async openWorkspaceDirectory(): Promise<WorkspaceDirectorySelection | null> {
    return null
  }
}
