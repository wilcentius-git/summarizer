import nextConfig from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "node_modules/**",
      "summarizer_venv/**",
    ],
  },
];

export default eslintConfig;
