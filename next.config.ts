import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // This app lives in a git worktree nested under the monorepo-style parent
  // directory, which also has a pnpm-workspace.yaml. Without an explicit
  // root, Turbopack infers the parent as the workspace root and then fails
  // to resolve client component modules ("Could not find the module ...
  // in the React Client Manifest").
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
