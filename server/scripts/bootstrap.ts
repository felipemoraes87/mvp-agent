import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runScript(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ["run", name], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm run ${name} failed with exit code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  for (const scriptName of ["import:legacy-sqlite", "prisma:seed", "context:apply", "sync:agno-catalog"]) {
    await runScript(scriptName);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
