export interface FileRef { path: string; name: string; size: number; hash: string }
export interface FileStatus { state: 'current' | 'changed' | 'missing'; file?: FileRef }
export interface FileEntry { name: string; path: string; kind: 'file' | 'directory'; size?: number }
export interface FileList { path: string; entries: FileEntry[]; total: number; offset: number; limit: number }
export interface Upload {
  uploadId: string; workspaceId: string; originalName: string; size: number;
  name?: string; path?: string; hash?: string;
  status: 'pending' | 'uploading' | 'completed' | 'cancelled' | 'failed'; error?: string;
}
export interface FileOutput extends FileRef { downloadId: string; workspaceId: string; sessionId: string; requestId: string; toolCallId: string; createdAt: string }
