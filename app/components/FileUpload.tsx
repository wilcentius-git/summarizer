"use client";

import { useCallback, useState } from "react";

const MAX_FILE_SIZE_MB = 500;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_AUDIO_SIZE_MB = 25;
const MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024;

const ACCEPTED_FILE_TYPES =
  ".pdf,.docx,.doc,.txt,.rtf,.odt,.srt,.mp3,.wav,.m4a,.webm,.flac,.ogg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,application/rtf,text/rtf,application/vnd.oasis.opendocument.text,application/x-subrip,audio/mpeg,audio/mp3,audio/mp4,audio/mpga,audio/wav,audio/webm,audio/flac,audio/ogg";

const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".rtf", ".odt", ".srt"];
const AUDIO_EXTENSIONS = [".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".flac", ".ogg"];

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/x-subrip",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/mpga",
  "audio/wav",
  "audio/webm",
  "audio/flac",
  "audio/ogg",
]);

function isSupportedFile(file: File): boolean {
  if (SUPPORTED_MIME_TYPES.has(file.type)) return true;
  if (file.type === "application/octet-stream" || !file.type) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    return [...DOCUMENT_EXTENSIONS, ...AUDIO_EXTENSIONS].includes(ext);
  }
  return false;
}

export function isAudioFile(file: File): boolean {
  if (["audio/mpeg", "audio/mp3", "audio/mp4", "audio/mpga", "audio/wav", "audio/webm", "audio/flac", "audio/ogg"].includes(file.type)) return true;
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  return AUDIO_EXTENSIONS.includes(ext);
}

export type FileItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  durationSeconds?: number;
};

function getAudioDurationInBrowser(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load audio"));
    };
    audio.src = url;
  });
}

export function useFileUpload(setError: (err: string | null) => void) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles?.length) return;
    setError(null);
    const added: FileItem[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (!isSupportedFile(file)) {
        setError(
          "Unsupported file type. Supported: PDF, DOCX, DOC, TXT, RTF, ODT, SRT, MP3, WAV, M4A, WebM, FLAC, OGG."
        );
        continue;
      }
      const maxSize = isAudioFile(file) ? MAX_AUDIO_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
      const maxSizeMB = isAudioFile(file) ? MAX_AUDIO_SIZE_MB : MAX_FILE_SIZE_MB;
      if (file.size > maxSize) {
        setError(`File ${file.name} exceeds ${maxSizeMB} MB${isAudioFile(file) ? " (audio limit)" : ""}.`);
        continue;
      }
      const id = `${file.name}-${file.size}-${Date.now()}-${i}`;
      added.push({ id, file, name: file.name, size: file.size });
      if (isAudioFile(file)) {
        getAudioDurationInBrowser(file)
          .then((duration) => {
            setFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, durationSeconds: duration } : f))
            );
          })
          .catch(() => {});
      }
    }
    setFiles((prev) => [...prev, ...added]);
  }, [setError]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setError(null);
  }, [setError]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  return { files, setFiles, dragActive, addFiles, removeFile, handleDrag, handleDrop, ACCEPTED_FILE_TYPES };
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
