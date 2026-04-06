/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdfjs-dist",
    "@ffprobe-installer/ffprobe",
    "ffmpeg-static",
    "fluent-ffmpeg",
  ],
  experimental: {
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
