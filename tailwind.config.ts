import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "kemenkum-blue": "#2D338F",
        "kemenkum-yellow": "#FBCD0B",
      },
    },
  },
  plugins: [],
};
export default config;
