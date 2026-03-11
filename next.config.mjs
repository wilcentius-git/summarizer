/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    middlewareClientMaxBodySize: "25mb",
    serverComponentsExternalPackages: [
      "@napi-rs/canvas",
      "pdfjs-dist",
      "@ffprobe-installer/ffprobe",
      "ffmpeg-static",
      "fluent-ffmpeg",
    ],
  },
};

export default nextConfig;
