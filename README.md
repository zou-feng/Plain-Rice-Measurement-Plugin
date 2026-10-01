# dsh-plugin-balance-pet

DeepSeek 余额看板娘 —— 一个可独立安装的 **DSH 网页端插件**（不是动态插件）。

页面**左下角**的浮层里坐着一位拿着平板的看板娘，平板玻璃区内三行文字，从上到下：

```
梁文谷 / 梁文峰      ← 当前价段称呼（谷价绿、峰价蓝）
¥ 23.21             ← 剩余余额（恒白）
158:47:24           ← 倒计时，染的是「它数向的那个价段」：指向谷=绿，指向峰=蓝
```

颜色规则：**名字**跟着当前价段（谷绿/峰蓝），**倒计时**跟着它数向的价段 ——
也就是和名字**正好相反**（现在谷价，倒计时就是蓝的，因为它在等峰价）。

- **峰谷不是只看钟点**，按 DeepSeek 官方口径：
  - 日常：北京时间 **00:30–08:30** 为空闲（谷价）时段，其余为峰价；
  - **周六、周日全天**按谷价（含调休上班的周末）；
  - **中国法定节假日**放假期间全天按谷价（整段假期，见 `lib/index.js` 里的年份表）。
- 第三行是**距离下一次峰谷切换的倒计时**，`小时:分钟:秒`；**小时不进位成天**，
  所以国庆连休会显示 `158:47:24`。它用的是 Host 的绝对时刻 + `serverTime` 校正，
  改系统时间骗不到它，后台标签页回到前台也是直接跳对，不是慢慢追。
- **左键按住可拖动**（就是单纯跟着鼠标走，没有任何动效）
- **左键点一下**：上下压扁、左右变宽的橡皮回弹（不是跳起来）
- **扣款**（余额减少）：头顶飘出红色 `-¥0.30`
- **到账**（余额增加）：头顶冒粉色 `❤`
- 初始位置由 CSS 锚定左下角，只在首次拖动时才转成像素坐标
- 余额约每 **3–5 秒**刷新一次；失败时平板显示原因，已拿到的数值保留
- 客户端任何异常都被 try/catch 拦住，只写 `console.error`，**不会**拖垮页面启动

## 版本与下载

当前版本 **1.1.0**（`assetVersion 28`）。每次改了什么见 [CHANGELOG.md](./CHANGELOG.md)。

| 分支 / 标签 | 内容 | 怎么拿到 |
| --- | --- | --- |
| `main` | 最新代码（当前 = 1.1.0） | 打开仓库就是它 |
| `version/1.1.0` | 1.1.0 的冻结快照 | 分支下拉切过去 → **Code → Download ZIP** |
| `version/1.0.0` | 1.0.0（第三行是北京时间、峰谷只按钟点、拖动有摆动） | 同上 |
| 标签 `v1.1.0` / `v1.0.0` | 同上面两个点 | **Releases** 页 |

打包好的插件包在 **[Releases](https://github.com/zou-feng/Plain-Rice-Measurement-Plugin/releases)**：
`v1.1.0` 附了 `dsh-plugin-balance-pet-1.1.0.tgz`，下载后直接
`dsh plugin --profile web add <那个 tgz>` 即可。

> `main` 会继续往前走，**已发布的版本固定在标签上**，所以 `main` 和 `version/1.1.0`
> 不一定永远相等 —— 想要「和 1.1.0 发布时一模一样」的那份，就用分支或标签。

## 设计要点：余额在 Host 侧查询

```
浏览器 ──GET /balance-pet/status────► Host（Node 进程）
                                          └── node:https ──► api.deepseek.com/user/balance
```

**页面从不直连 DeepSeek**，原因有两条（都是实测踩出来的）：

1. Host 的 `web` 服务只解码带已知 content-type 的 html/text 响应，**读不了 JSON 余额接口**
   （报 `unsupported content type "unknown"`）。
2. 页面的跨源 `fetch` 打 `api.deepseek.com` 在这里**不可靠**（预检被挡），
   表现就是平板上的余额永远是 `--`。

把查询放在 Host 还顺带把 **API key 完全挡在浏览器之外**。

## 目录结构

```
dsh-plugin-balance-pet/
├── package.json            插件清单（dsh.bundle = 自带 patch 层；dsh.client = 浏览器半边）
├── cordis.patch.yml        本插件的 bundle patch：一行加载器条目
├── assets/sprite.png       看板娘底图（560×373，RGBA 透明底）
├── lib/
│   ├── index.js            Host 半：凭据解析、余额查询、峰谷规则与节假日表、四条静态路由
│   ├── client.js           浏览器半：手写 bundle（无需构建）
│   └── style.css           样式表
├── tools-test-schedule.cjs 峰谷规则的离线单测（21 个已知时刻 + 4000 次模糊测试）
├── tools-audit.cjs         静态自查：把踩过的坑逐条钉成断言
├── tools-edge-profile.cjs  量平板上下边框角度（开发用）
├── tools-measure-panel.cjs 量平板玻璃区域（开发用）
├── tools-measure-text.cjs  光栅化量文字真实宽度（开发用）
├── tools-render-preview.cjs 把文字合成到底图出预览（开发用）
├── tools-verify-from-css.cjs 从 style.css 反读数值，算旋转后是否在平板内
├── INSTALL.md              详细安装教程（换一台电脑装的话看这个）
├── CHANGELOG.md            更新日志（语义化版本）
└── TUNING.md               调参手册：角度/位置/字号/刷新速度改哪里
```

## Host 半提供的接口

| 路由 | 说明 |
| --- | --- |
| `GET /balance-pet/status` | 余额 + 价段 + 下次切换时刻（页面轮询这个） |
| `GET /balance-pet/config` | 资产版本号、谷价窗口、全年全天谷价日期表（**不含任何凭据**） |
| `GET /balance-pet/sprite` | 看板娘底图（image/png，`no-cache` + ETag） |
| `GET /balance-pet/style` | 样式表（text/css，`no-cache` + ETag） |

状态快照示例：

```json
{
  "serverTime": 1790817155848,
  "valley": true, "label": "梁文谷",
  "window": { "fromMinute": 30, "untilMinute": 510 },
  "nextSwitchAt": 1791388800000,
  "ok": true, "balance": 23.21, "currency": "CNY",
  "message": null, "ageMs": 1200
}
```

`nextSwitchAt` 是**绝对时间戳**，页面用它减去 `serverTime` 得到倒计时，
再按 `serverTime - Date.now()` 修正本机时钟偏差。

## 安装

> 换一台电脑装、或者要图文逐步的教程，看 **[INSTALL.md](./INSTALL.md)**（含故障排查表）。
> 下面是速查版。

### 方式 A：一条命令（推荐）

```powershell
dsh plugin --profile web add <本目录的绝对路径或 .tgz 路径>
```

它内部走 `pnpm add`，然后**自动**把这个包追加进 profile 的 `dsh.profile.bundles`
（因为本包声明了 `dsh.bundle.patch`），加载器条目由本包自带的 `cordis.patch.yml` 提供，
**不需要手改任何 profile 文件**。装完重启 DSH。

> `dsh plugin` 需要 PATH 上有 `pnpm`。一键版 DSH 自带 pnpm 但没加进 PATH：
> ```powershell
> $pnpm = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
> ```

### 方式 B：手工接线（没有 pnpm 时）

`dsh web` 是 `--profile web` 的别名，profile 目录为 `<DSH_HOME>\profiles\web`。

1. 让 Node 能从 profile 解析到这个包名：

   ```powershell
   New-Item -ItemType Junction -Path "<profile>\node_modules\dsh-plugin-balance-pet" `
            -Target "<本目录的绝对路径>"
   ```

2. 在 `<profile>\cordis.patch.yml` 加一行：

   ```yaml
   - insert:
       - id: balance-pet
         name: dsh-plugin-balance-pet
   ```

**不要**去改 profile 的 `package.json` 加 `link:` 依赖 —— 链接缺失或失效时启动会直接失败
（`ERR_MODULE_NOT_FOUND`）。保持 `dependencies` 为空最安全。

### 卸载

删除 `cordis.patch.yml` 里那行，并移除 `node_modules` 里的 `dsh-plugin-balance-pet`，重启即可。

## 账号配置

插件**不需要单独导入账号** —— 它读 DSH 自己的凭据库，并在**每次查询时重新解析**：

```
$DSH_HOME/.credentials.yaml
  refs:
    DEEPSEEK_API_KEY: sk-xxxxxxxx
```

三种写入方式任选：

1. **界面（推荐）**：DSH 网页 → 设置 → 模型 → DeepSeek 卡片填 API Key 保存
2. **手改文件**：编辑 `$DSH_HOME/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`（DSH 监听该文件，存盘即生效）
3. **环境变量**：启动 DSH 前设 `DEEPSEEK_API_KEY`（优先级最高，会**遮蔽**文件里的值）

验证 key（不消耗额度，只查余额）：

```powershell
curl.exe -s -H "Authorization: Bearer sk-你的key" https://api.deepseek.com/user/balance
```

## 三个必须知道的坑（都踩过）

| 症状 | 原因 | 规避 |
| --- | --- | --- |
| DSH **完全打不开**，日志报 `must be a top-level YAML array of loader patch entries` | `cordis.patch.yml` 带了 **UTF-8 BOM**（PowerShell `Set-Content -Encoding UTF8` 会加） | 用不带 BOM 的写法保存；本包自带的 patch 无 BOM |
| 启动报 `failed to import loader entry balance-pet ... Cannot find package` | 加载器条目找不到包：`node_modules` 里没有链接，或链接被删 | 恢复链接（方式 B 第 1 步）；不要留悬空的 `link:` 依赖 |
| 插件日志有 `ready` 但路由 **404** | Host 未声明 `inject: ['webServer']`，`apply` 在 HTTP 服务就绪**之前**运行 | 必须声明该依赖（本包已声明），让条目等导航服务就绪后再挂载 |
| 平板上时间/余额**永远 `--`**，价段停在初始值 | 浏览器半**没有导出 `inject`**，`ctx.interval` 被 cordis 守卫拒绝 → 定时器从未启动 → `/status` 一次都没请求 | 浏览器半必须 `exports.inject = ['timer']`（本包已导出） |

## 开发

```powershell
# 语法自检
node --check lib/index.js
node --check lib/client.js

# 开发工具需要 sharp（仅开发用，插件运行时零依赖）
npm i -D sharp

# 峰谷规则的单测（21 个已知时刻 + 4000 次模糊测试）
node tools-test-schedule.cjs
# 静态自查：把踩过的坑逐条钉成断言
node tools-audit.cjs

# 量平板边框角度 / 文字真实宽度 / 出预览图 / 校验是否超框
node tools-edge-profile.cjs
node tools-measure-text.cjs
node tools-render-preview.cjs 2.9 5.5 2.55 preview.png box valley
node tools-verify-from-css.cjs
```

用一次性 `DSH_HOME` 在别的端口验证，不影响正在运行的服务：

```powershell
$env:DSH_HOME='<某个空目录>'
# 建 profiles/web/{package.json,cordis.yml,cordis.patch.yml}
# 在 profiles/web/node_modules 里联接到本目录
node <dsh>/lib/bin.js web --port 3105 --no-open
# 期望日志：balance-pet: routes ready (4/4)
```

> 端口被占用（`EADDRINUSE`）会让 WebServer 直接失败，**看起来像插件问题**。换干净端口最省事。

## 调参

角度、位置、字号、刷新速度全部可在 `lib/style.css` 与 `lib/index.js` 里改，
每项的文件、行号、方向判断和安全范围见 **[TUNING.md](./TUNING.md)**。

改完的生效方式：**样式**普通刷新即可（资源带 `no-cache` + 版本号）；
**JS** 需要重启 DSH。

## 许可

MIT —— 见 [LICENSE](./LICENSE)。

变更历史见 [CHANGELOG.md](./CHANGELOG.md)。
