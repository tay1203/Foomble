const { spawn } = require("node:child_process");

// On some Windows setups, Firebase's HTTP function discovery can start more
// slowly than its default 10-second allowance. Keep the emulator responsive
// while giving discovery enough time to register the function manifest.
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--yes", "firebase-tools", "emulators:start"],
  {
    env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: "30" },
    stdio: "inherit",
    // Windows command shims such as npx.cmd must run through cmd.exe.
    shell: process.platform === "win32",
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
