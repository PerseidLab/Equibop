import { cpSync, existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "fs";
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
    const destBinaryPath = join(binDir, "discord-rpc-bridge");

    const downloadUrl = "https://github.com/barrettotte/discord-rpc-bridge/releases/download/v0.1.2/discord-rpc-bridge";

    if (!existsSync(destBinaryPath)) {
        console.log(`Downloading discord-rpc-bridge to ${destBinaryPath}...`);
        try {
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            writeFileSync(destBinaryPath, Buffer.from(arrayBuffer));
            chmodSync(destBinaryPath, 0o755);
        } catch (error) {
            console.warn("Fetch failed, trying curl fallback...", error.message);
            execSync(`curl -L -o "${destBinaryPath}" "${downloadUrl}"`);
            chmodSync(destBinaryPath, 0o755);
        }
    } else {
        console.log(`discord-rpc-bridge already exists. Ensuring executable permissions (0755)...`);
        chmodSync(destBinaryPath, 0o755);
    }

    const appRunPath = join(appOutDir, "AppRun");
    if (existsSync(appRunPath)) {
        console.log("Injecting discord-rpc-bridge hook into AppRun...");
        let appRunContent = readFileSync(appRunPath, "utf8");

        const hookCode = `
        # --- Injected Service ---
        usr/bin/discord-rpc-bridge &
        BRIDGE_PID=$!

        # Enforce cleanup trap handling upon termination
        trap 'kill $BRIDGE_PID' EXIT INT TERM
        # ------------------------
        `;

        if (appRunContent.includes("#!/bin/")) {
            appRunContent = appRunContent.replace(/(^#!.*?\n)/, `$1${hookCode}\n`);
            writeFileSync(appRunPath, appRunContent, "utf8");
            console.log("AppRun successfully patched.");
        } else {
            console.error("Warning: AppRun file format unexpected. Shebang not found.");
        }
    } else {
        console.warn(`Warning: AppRun not found at ${appRunPath}. Make sure electron-builder is configured for AppImage targets.`);
    }
}

export default async function afterPack(context) {
    await copyArRPCBinaries(context);
    await integrateDiscordRpcBridge(context);
    await addAssetsCar(context);
}
