import { cpSync, existsSync, mkdirSync, chmodSync, createWriteStream } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";

import { addAssetsCar } from "./addAssetsCar.mjs";

async function downloadDiscordRPCBridge(context) {
    const { appOutDir } = context;
    
    const binaryName = "discord-rpc-bridge";
    const destPath = join(appOutDir, binaryName);
    const downloadUrl = `https://github.com/barrettotte/discord-rpc-bridge/releases/download/v0.1.2/${binaryName}`;

    console.log(`Downloading ${binaryName} from GitHub releases...`);

    try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch binary: ${response.statusText} (${response.status})`);
        }

        // Stream the download directly to the appOutDir root
        const fileStream = createWriteStream(destPath);
        // @ts-ignore - response.body is a ReadableStream
        await pipeline(response.body, fileStream);
        console.log(`Successfully downloaded bridge to: ${destPath}`);

        // Give it executable permissions (rwxr-xr-x)
        chmodSync(destPath, 0o755);
        console.log(`Set executable permissions (0755) for ${binaryName}`);
        
    } catch (error) {
        console.error(`Error downloading discord-rpc-bridge: ${error.message}`);
    }
}

async function copyArRPCBinaries(context) {
    const { electronPlatformName, arch, appOutDir } = context;

    // map electron-builder arch enum to string
    // 0 = ia32, 1 = x64, 2 = armv7l, 3 = arm64
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

export default async function afterPack(context) {
    // Only run the download if we are building for Linux to avoid unnecessary bloat on other platforms
    if (context.electronPlatformName === "linux") {
        await downloadDiscordRPCBridge(context);
    }
    
    await copyArRPCBinaries(context);
    await addAssetsCar(context);
}
