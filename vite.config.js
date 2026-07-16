import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const repositoryName =
    env.VITE_GITHUB_PAGES_REPO ||
    process.env.GITHUB_REPOSITORY?.split("/").pop() ||
    "";
  const base = env.VITE_BASE_PATH || (repositoryName ? `/${repositoryName}/` : "./");

  return {
    base,
    plugins: [react()],
  };
});
