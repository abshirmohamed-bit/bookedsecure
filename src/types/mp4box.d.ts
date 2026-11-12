/** The small part of mp4box.js (0.5.x) the fast browser render uses. */
declare module "mp4box" {
  export interface MP4Sample { offset: number; size: number; cts: number; dts: number; duration: number; is_sync: boolean; timescale: number }
  export interface MP4TrackInfo {
    id: number; codec: string; type?: string; timescale: number; nb_samples: number;
    video?: { width: number; height: number };
    audio?: { sample_rate: number; channel_count: number };
  }
  export interface MP4Info { tracks: MP4TrackInfo[]; videoTracks: MP4TrackInfo[]; audioTracks: MP4TrackInfo[]; duration: number; timescale: number }
  export type MP4ArrayBuffer = ArrayBuffer & { fileStart: number };
  export interface MP4File {
    onReady?: (info: MP4Info) => void;
    onError?: (e: string) => void;
    appendBuffer(data: MP4ArrayBuffer): number;
    flush(): void;
    getTrackById(id: number): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  export function createFile(): MP4File;
  export class DataStream {
    constructor(buffer?: ArrayBuffer, offset?: number, endianness?: boolean);
    static BIG_ENDIAN: boolean;
    buffer: ArrayBuffer;
  }
}
