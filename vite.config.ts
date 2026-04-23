import { defineConfig } from "vite";

export default defineConfig({
    base: "/widget/nico-chat/",
    build: {
        outDir: "dist",
        emptyOutDir: true,
    }
});
