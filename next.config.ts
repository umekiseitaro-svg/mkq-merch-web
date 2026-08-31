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
};

export default nextConfig;
