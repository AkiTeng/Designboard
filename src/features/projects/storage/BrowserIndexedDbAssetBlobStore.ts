import type { AssetBlobStore } from './assetBlobStore'

const DATABASE_NAME = 'designboard-assets'
const DATABASE_VERSION = 1
const STORE_NAME = 'asset-blobs'

type AssetBlobRecord = {
  blobKey: string
  blob: Blob
}

export class BrowserIndexedDbAssetBlobStore implements AssetBlobStore {
  async saveBlob(blobKey: string, blob: Blob): Promise<void> {
    const database = await this.openDatabase()

    await this.runRequest(
      database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put({ blobKey, blob } satisfies AssetBlobRecord),
    )
  }

  async loadBlob(blobKey: string): Promise<Blob | null> {
    const database = await this.openDatabase()
    const record = (await this.runRequest(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(blobKey),
    )) as AssetBlobRecord | undefined

    return record?.blob ?? null
  }

  async deleteBlob(blobKey: string): Promise<void> {
    const database = await this.openDatabase()
    await this.runRequest(
      database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .delete(blobKey),
    )
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

      request.onerror = () => {
        reject(request.error ?? new Error('Failed to open IndexedDB'))
      }

      request.onupgradeneeded = () => {
        const database = request.result

        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, {
            keyPath: 'blobKey',
          })
        }
      }

      request.onsuccess = () => {
        resolve(request.result)
      }
    })
  }

  private runRequest<T>(request: IDBRequest<T>) {
    return new Promise<T>((resolve, reject) => {
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB request failed'))
      }

      request.onsuccess = () => {
        resolve(request.result)
      }
    })
  }
}
