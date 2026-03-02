declare module "fluent-ffmpeg" {
  interface FfmpegCommand {
    setStartTime(time: number | string): FfmpegCommand;
    setDuration(duration: number | string): FfmpegCommand;
    format(format: string): FfmpegCommand;
    audioCodec(codec: string): FfmpegCommand;
    audioBitrate(bitrate: number | string): FfmpegCommand;
    audioChannels(channels: number): FfmpegCommand;
    audioFrequency(freq: number): FfmpegCommand;
    on(event: "error", callback: (err: Error) => void): FfmpegCommand;
    pipe(
      stream?: NodeJS.WritableStream,
      options?: { end?: boolean }
    ): NodeJS.ReadableStream;
  }

  interface FfmpegStatic {
    (input?: string): FfmpegCommand;
    setFfmpegPath(path: string): void;
    setFfprobePath(path: string): void;
    ffprobe(
      path: string,
      callback: (err: Error | null, metadata: { format: { duration?: number } }) => void
    ): void;
  }

  const ffmpeg: FfmpegStatic;
  export default ffmpeg;
}
