export interface AssetBlobStore {
  saveBlob(blobKey: string, blob: Blob): Promise<void>
  loadBlob(blobKey: string): Promise<Blob | null>
  deleteBlob(blobKey: string): Promise<void>
}
