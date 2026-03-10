import { FileSystemRepository } from '../../projects/storage/FileSystemRepository'
import { TauriHostBridge } from '../TauriHostBridge'
import { TauriDialogPort, type TauriWorkspaceDialogPortInput } from './TauriDialogPort'
import {
  TauriFileSystemAdapter,
  type TauriFileSystemPort,
} from './TauriFileSystemAdapter'

type CreateTauriHostBridgeInput = {
  canvasId: string
  fileSystemPort: TauriFileSystemPort
  dialogPort: TauriWorkspaceDialogPortInput
}

export function createTauriHostBridge(input: CreateTauriHostBridgeInput) {
  const fileSystemAdapter = new TauriFileSystemAdapter(input.fileSystemPort)
  const workspaceRepositoryFactory = () =>
    new FileSystemRepository(fileSystemAdapter, input.canvasId)

  return new TauriHostBridge({
    workspaceRepositoryFactory,
    dialogPort: new TauriDialogPort(input.dialogPort),
  })
}
