export interface VideoFormat { formatId: string; ext: string; quality: string; resolution?: string; filesize?: number | null; hasVideo: boolean; hasAudio: boolean; }
export interface VideoInfoRequest { url: string; }
export interface VideoInfoResponse { title: string; thumbnail?: string | null; duration?: number | null; uploader?: string | null; platform: string; formats: VideoFormat[]; }
export interface DownloadRequest { url: string; formatId: string; }
export interface DownloadResponse { downloadUrl: string; filename: string; ext: string; }
export interface ErrorResponse { error: string; code?: string; retryAfter?: number; }
