/**
 * build-exe.mjs — Agnes 漫剧工坊 · Windows 单文件 exe
 * ------------------------------------------------------------------
 * Node SEA：把 server.js 作为入口，把 lib/ 与 public/ 内嵌进 blob，
 * 再注入 managed Node 运行时。接收方无需安装 Node，双击即用。
 *
 * 用法：node tools/build-exe.mjs
 * 可选：node tools/build-exe.mjs --out Agnes漫剧工坊.exe
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ================= 配置区域 =================
// ⚠️ 请检查这里的入口文件是否正确！
// 如果你的主入口是 index.js 或 main.js，请修改下面的 'server.js'
const entryFile = path.join(rootDir, 'server.js'); 
const distDir = path.join(rootDir, 'dist');
const blobPath = path.join(distDir, 'sea-prep.blob');
const exePath = path.join(distDir, 'Agnes漫剧工坊.exe'); // 生成的exe名称
const seaConfigPath = path.join(rootDir, 'sea-config.json');
// ============================================

function runCommand(cmd) {
    try {
        execSync(cmd, { stdio: 'inherit', cwd: rootDir });
    } catch (error) {
        console.error(`\n❌ 执行命令失败: ${cmd}`);
        process.exit(1);
    }
}

async function build() {
    console.log('🚀 开始打包 EXE...');

    // 1. 检查入口文件
    if (!fs.existsSync(entryFile)) {
        console.error(`❌ 找不到入口文件: ${entryFile}`);
        console.error(`👉 请打开 tools/build-exe.mjs，修改 entryFile 变量为你项目的真正入口（如 index.js、main.js 或 app.js）`);
        process.exit(1);
    }

    // 2. 创建 dist 目录
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    // 3. 收集需要内嵌到 SEA 的全部运行时资源
    // server.js 在 SEA 模式下会从 sea.getAssetKeys() 释放 lib/ 与 public/。
    // 如果这里不声明 assets，EXE 虽然能“构建成功”，启动时却会因为找不到
    // lib/store.js / public/index.html 等资源而直接退出。
    function collectAssets(dir, prefix) {
        const assets = {};
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            const key = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) {
                Object.assign(assets, collectAssets(fullPath, key));
            } else if (entry.isFile()) {
                assets[key.replaceAll(path.sep, '/')] = fullPath;
            }
        }
        return assets;
    }

    const assets = {
        ...collectAssets(path.join(rootDir, 'lib'), 'lib'),
        ...collectAssets(path.join(rootDir, 'public'), 'public'),
    };

    const assetKeys = Object.keys(assets);
    if (!assetKeys.includes('lib/store.js') || !assetKeys.includes('public/index.html')) {
        console.error('❌ SEA 资源收集失败：缺少 lib/store.js 或 public/index.html');
        process.exit(1);
    }

    // Node 20 的 node:sea 没有 getAssetKeys()，把资源键名单独作为 SEA asset 内嵌。
    const manifestPath = path.join(distDir, 'agnes-asset-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(assetKeys), 'utf8');
    assets['__agnes_asset_manifest.json'] = manifestPath;

    console.log(`📦 将内嵌 ${assetKeys.length} 个资源文件 + 1 个资源清单`);

    // 4. 生成 sea-config.json
    const seaConfig = {
        main: entryFile,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        assets,
    };
    fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));
    console.log('✅ 已生成 sea-config.json');

    // 5. 生成 SEA blob
    console.log('⏳ 正在生成 SEA blob...');
    runCommand(`node --experimental-sea-config sea-config.json`);

    // 6. 复制 Node.js 可执行文件
    console.log('⏳ 正在复制 Node.js 可执行文件...');
    const nodeExe = process.execPath;
    fs.copyFileSync(nodeExe, exePath);

    // 7. 寻找 postject（修复找不到 postject 的问题）
    console.log('⏳ 正在寻找 postject 工具...');
    let postjectCmd = '';
    
    // 优先使用项目 node_modules 里安装的 postject
    const localPostject = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'postject.cmd' : 'postject');
    
    if (fs.existsSync(localPostject)) {
        postjectCmd = `"${localPostject}"`;
        console.log('✅ 找到本地 postject');
    } else {
        console.log('⚠️ 未在本地 node_modules 找到 postject，尝试使用 npx...');
        postjectCmd = 'npx postject';
    }

    // 8. 注入 SEA blob
    console.log('⏳ 正在注入 SEA blob 到 exe...');
    // Node.js 20 版本的 Sentinel Fuse
    const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'; 
    const injectCommand = `${postjectCmd} "${exePath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse ${sentinelFuse}`;
    
    runCommand(injectCommand);

    console.log(`\n🎉 打包成功！生成的 exe 文件位于: ${exePath}`);
}

build();
