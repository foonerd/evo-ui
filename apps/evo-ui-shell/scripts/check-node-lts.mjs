#!/usr/bin/env node

const major = Number.parseInt(process.versions.node.split(".")[0], 10);

if (!Number.isFinite(major) || major < 22) {
  console.error(
    [
      "ERROR: Node.js 22 LTS or newer is required for apps/evo-ui-shell.",
      `Detected Node.js ${process.versions.node}.`,
      "",
      "Policy:",
      "- Supported target devices run a current Raspberry Pi OS / Debian release.",
      "- UI build/test tooling runs on the development host, not on target device.",
      "- Development host must run Node.js 22 LTS+ for Vite 7 toolchain compatibility.",
    ].join("\n"),
  );
  process.exit(1);
}

