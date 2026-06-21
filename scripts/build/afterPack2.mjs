import {
    cpSync,
    existsSync,
    mkdirSync,
    writeFileSync,
    chmodSync,
    renameSync
} from "fs";

import { join } from "path";
import { execSync } from "child_process";

import { addAssetsCar } from "./addAssetsCar.mjs";

async function copyArRPCBinaries(context) {
    const { electronPlatformName, arch, appOutDir } = context;

    const archMap = {
        0: "ia32",
        1: "x64",
        2: "armv7l",
        3: "arm64"
    };

    const archString =
        typeof arch === "number" ? archMap[arch] : arch;

    if (archString === "universal" || archString === undefined) {
        console.log(
            "Skipping arRPC copy for universal build (already merged from x64/arm64)"
        );
        return;
    }

    const resourcesDir = join(
        appOutDir,
        electronPlatformName === "darwin"
            ? `${context.packager.appInfo.productFilename}.app/Contents/Resources`
            : "resources"
    );

    const arrpcDestDir = join(resourcesDir, "arrpc");

    mkdirSync(arrpcDestDir, { recursive: true });

    const arrpcSourceDir = join(process.cwd(), "static", "dist");

    const platformName =
        electronPlatformName === "win32"
            ? "windows"
            : electronPlatformName;

    let binaryName = `arrpc-${platformName}-${archString}`;

    if (electronPlatformName === "win32") {
        binaryName += ".exe";
    }

    const binarySourcePath = join(arrpcSourceDir, binaryName);

    if (!existsSync(binarySourcePath)) {
        console.warn(`Warning: arRPC binary not found: ${binarySourcePath}`);
        console.warn("Run 'bun compileArrpc' to build arRPC binaries");
        return;
    }

    const destBinaryName =
        electronPlatformName === "win32"
            ? "arrpc.exe"
            : "arrpc";

    const binaryDestPath = join(arrpcDestDir, destBinaryName);

    console.log(
        `Copying arRPC binary: ${binaryName} -> ${destBinaryName}`
    );

    cpSync(binarySourcePath, binaryDestPath);

    if (electronPlatformName !== "win32") {
        chmodSync(binaryDestPath, 0o755);
    }
}

async function integrateDiscordRpcBridge(context) {
    const { electronPlatformName, arch, appOutDir } = context;

    const archMap = {
        0: "ia32",
        1: "x64",
        2: "armv7l",
        3: "arm64"
    };

    const archString =
        typeof arch === "number" ? archMap[arch] : arch;

    if (
        electronPlatformName !== "linux" ||
        archString !== "x64"
    ) {
        return;
    }

    console.log("Integrating discord-rpc-bridge...");

    const binDir = join(appOutDir, "usr", "bin");

    mkdirSync(binDir, { recursive: true });

    const bridgePath = join(binDir, "discord-rpc-bridge");

    const downloadUrl =
        "https://github.com/barrettotte/discord-rpc-bridge/releases/download/v0.1.2/discord-rpc-bridge";

    //
    // Download bridge binary
    //
    if (!existsSync(bridgePath)) {
        console.log(`Downloading discord-rpc-bridge...`);

        try {
            const response = await fetch(downloadUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const arrayBuffer =
                await response.arrayBuffer();

            writeFileSync(
                bridgePath,
                Buffer.from(arrayBuffer)
            );
        } catch (error) {
            console.warn(
                "Fetch failed, using curl fallback:",
                error?.message ?? error
            );

            execSync(
                `curl -L -o "${bridgePath}" "${downloadUrl}"`,
                { stdio: "inherit" }
            );
        }
    }

    chmodSync(bridgePath, 0o755);

    //
    // Replace equibop.bin with wrapper
    //
    const originalBinaryPath = join(
        appOutDir,
        "equibop.bin"
    );

    const renamedBinaryPath = join(
        appOutDir,
        "equibop2.bin"
    );

    console.log("Checking Equibop launcher...");
    console.log(`Original: ${originalBinaryPath}`);
    console.log(`Renamed : ${renamedBinaryPath}`);

    if (!existsSync(renamedBinaryPath)) {
        if (!existsSync(originalBinaryPath)) {
            throw new Error(
                `Expected binary not found: ${originalBinaryPath}`
            );
        }

        console.log(
            "Renaming equibop.bin -> equibop2.bin"
        );

        renameSync(
            originalBinaryPath,
            renamedBinaryPath
        );
    }

    if (!existsSync(renamedBinaryPath)) {
        throw new Error(
            `Failed to create ${renamedBinaryPath}`
        );
    }

    //
    // Wrapper script
    //
    const wrapperScript = `#!/bin/bash
set -e

BASE_DIR="\${APPDIR:-\$(dirname "\$(dirname "\$(dirname "\$0")")")}"

"\$BASE_DIR/usr/bin/discord-rpc-bridge" >/dev/null 2>&1 &
BRIDGE_PID=$!

cleanup() {
    kill \$BRIDGE_PID 2>/dev/null || true
}

trap cleanup EXIT INT TERM

exec "\$(dirname "\$0")/equibop2.bin" "\$@"
`;

    console.log("Writing wrapper script...");

    writeFileSync(
        originalBinaryPath,
        wrapperScript,
        "utf8"
    );

    chmodSync(originalBinaryPath, 0o755);

    console.log(
        "discord-rpc-bridge integration complete."
    );
}

export default async function afterPack(context) {
    await copyArRPCBinaries(context);
    await integrateDiscordRpcBridge(context);
    await addAssetsCar(context);
}
