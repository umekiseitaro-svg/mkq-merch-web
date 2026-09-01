import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Without this, Next.js walks up from this directory looking for a
    // lockfile and can pick up an unrelated one higher up the filesystem
    // (e.g. in the user's home directory), causing Turbopack to watch a
    // much larger tree than intended.
    root: path.join(__dirname),
  },
  async headers() {
    // "/" is statically prerendered, and /mkq-app.js is a plain static file --
    // both are prime targets for a browser (iOS Safari especially, and any
    // "Add to Home Screen" standalone view) to cache aggressively. If the
    // page's HTML and the script end up cached from two different deploys,
    // the script can reference DOM elements the cached HTML doesn't have,
    // and a click handler fails silently. Force revalidation on every load
    // so a new deploy is always picked up together, HTML and JS in sync.
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/mkq-app.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        // Service Workerの更新をブラウザがすぐ検知できるよう、こちらも
        // 明示的にキャッシュを無効化する（SWの仕組み自体が別途、
        // アプリの外側をCache Storageへ保存する役割を担う）。
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
