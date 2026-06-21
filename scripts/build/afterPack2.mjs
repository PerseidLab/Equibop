import { cpSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

import { addAssetsCar } from "./addAssetsCar.mjs";

async function copyArRPCBinaries(context) {
    const { electronPlatformName, arch, appOutDir } = context;

    const archMap = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" };
    const archString = typeof arch === "number" ? archMap[arch] : arch;

    if (archString === "universal" || archString === undefined) {
        console.log("Skipping arRPC copy for universal build (already merged from x64/arm64)");
        return;
    }

    const resourcesDir = join(appOutDir, electronPlatformName === "darwin" ? `${context.packager.appInfo.productFilename}.app/Contents/Resources` : "resources");
    const arrpcDestDir = join(resourcesDir, "arrpc");

    mkdirSync(arrpcDestDir, { recursive: true });

    const arrpcSourceDir = join(process.cwd(), "static", "dist");
    const platformName = electronPlatformName === "win32" ? "windows" : electronPlatformName;

    let binaryName = `arrpc-${platformName}-${archString}`;
    if (electronPlatformName === "win32") binaryName += ".exe";

    const binarySourcePath = join(arrpcSourceDir, binaryName);
    if (existsSync(binarySourcePath)) {
        const destBinaryName = electronPlatformName === "win32" ? "arrpc.exe" : "arrpc";
        const binaryDestPath = join(arrpcDestDir, destBinaryName);
        console.log(`Copying arRPC binary: ${binaryName} -> ${destBinaryName}...`);
        cpSync(binarySourcePath, binaryDestPath);
    } else {
        console.warn(`Warning: arRPC binary not found: ${binarySourcePath}`);
        console.warn("Run 'bun compileArrpc' to build arRPC binaries");
    }
}

async function integrateDiscordRpcBridge(context) {
    const { electronPlatformName, arch, appOutDir } = context;

    const archMap = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" };
    const archString = typeof arch === "number" ? archMap[arch] : arch;

    if (electronPlatformName !== "linux" || archString !== "x64") {
        return;
    }

    const binDir = join(appOutDir, "usr", "bin");
    mkdirSync(binDir, { recursive: true });
    
    // 1. Download discord-rpc-bridge
    const bridgePath = join(binDir, "discord-rpc-bridge");
    const downloadUrl = "https://github.com/barrettotte/discord-rpc-bridge/releases/download/v0.1.2/discord-rpc-bridge";

    if (!existsSync(bridgePath)) {
        console.log(`Downloading discord-rpc-bridge to ${bridgePath}...`);
        try {
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            writeFileSync(bridgePath, Buffer.from(arrayBuffer));
            chmodSync(bridgePath, 0o755);
        } catch (error) {
            console.warn("Fetch failed, trying curl fallback...", error.message);
            execSync(`curl -L -o "${bridgePath}" "${downloadUrl}"`);
            chmodSync(bridgePath, 0o755);
        }
    } else {
        console.log(`discord-rpc-bridge already exists. Ensuring executable permissions (0755)...`);
        chmodSync(bridgePath, 0o755);
    }

    // 2. Binary Swapping Logic
    const originalBinaryPath = join(appOutDir, "equibop");
    const renamedBinaryPath = join(appOutDir, "equibop2");

    if (existsSync(originalBinaryPath) && !existsSync(renamedBinaryPath)) {
        console.log("Renaming original equibop binary to equibop2...");
        cpSync(originalBinaryPath, renamedBinaryPath); 
        execSync(`rm "${originalBinaryPath}"`); 
    }

    // 3. Deploy Wrapper Script to original 'equibop' path
    console.log("Generating the custom equibop wrapper script...");
    
    const wrapperScriptContent = `#!/bin/bash

# Define the base directory using APPDIR or fallback to the script's actual directory
BASE_DIR="\${APPDIR:-\$(dirname "\$(dirname "\$(dirname "\$0")")")}"

# Start the RPC bridge in the background using the resolved AppImage path
"\$BASE_DIR/usr/bin/discord-rpc-bridge" > /dev/null 2>&1 &
BRIDGE_PID=$!

# Ensure the bridge closes cleanly when equibop2 finishes
cleanup() {
    kill \$BRIDGE_PID 2>/dev/null
}
trap cleanup EXIT INT TERM

# Execute the actual application binary, passing along any runtime parameters
"\$(dirname "\$0")/equibop2" "\$@"
`;

    writeFileSync(originalBinaryPath, wrapperScriptContent, { encoding: "utf8" });
    chmodSync(originalBinaryPath, 0o755); 
    console.log("Wrapper successfully deployed.");
}

export default async function afterPack(context) {
    await copyArRPCBinaries(context);
    await integrateDiscordRpcBridge(context);
    await addAssetsCar(context);
}
