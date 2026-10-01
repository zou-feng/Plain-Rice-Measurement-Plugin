# 在其他电脑上安装

本插件是 **DSH 的网页端独立插件**,装一次之后**随 DSH 启动自动加载**,重启也不会丢。

---

## 0. 目标电脑需要什么

| 需要 | 说明 |
| --- | --- |
| **能正常运行的 DSH** | 一键版或源码版都行。没跑过一次的话 `profiles/web` 还不存在,先启动一次 |
| **Node.js** | DSH 自带的就行,不用另装 |
| **插件文件** | 见第 1 步 |
| **`pnpm`**(仅方式一需要) | 一键版自带,但没加进 PATH,见 2.1 |
| **DeepSeek API Key** | 见第 3 步 |

**不需要**的东西:不需要联网装依赖、不需要 `sharp`(那是本仓库 `tools-*.cjs` 开发工具用的,
插件运行时**零依赖**)、不需要编译。

---

## 1. 把插件文件弄到目标电脑

两种载体,任选:

### A. 拷贝整个文件夹(推荐,方便以后改)

```
dsh-plugin-balance-pet/          ← 整个文件夹拷过去
```

放到一个**长期不会删**的路径,例如:

```
D:\dsh-plugins\dsh-plugin-balance-pet\
```

> ⚠️ 路径里**不要有中文和空格**更稳(node 模块解析对特殊字符敏感)。

### B. 拷贝打包好的 tarball

```
dsh-plugin-balance-pet-1.1.0.tgz          ← 单文件,约 109KB
```

随便放哪都行,例如 `D:\dsh-plugin-balance-pet-1.1.0.tgz`。

---

## 2. 安装

DSH 的网页模式用的是 `web` 这个 profile(`dsh web` 命令是 `--profile web` 的别名)。
所以下面所有操作都针对 profile 名 `web`。

### 2.1 先确认 DSH_HOME 在哪

**一键版**:一般是 `<一键版安装目录>\data\dsh`
**源码版 / 默认**:`%USERPROFILE%\.dsh`

在 PowerShell 里确认:

```powershell
# 一键版启动脚本会设这个变量;若在 DSH 自身进程里则为 $env:DSH_HOME
# 手动判断:看哪个目录下有 profiles 和 .credentials.yaml
Test-Path "$env:USERPROFILE\.dsh\profiles"
Test-Path "<一键版安装目录>\data\dsh\profiles"
```

下文用 `<DSH_HOME>` 代指它。**profile 目录 = `<DSH_HOME>\profiles\web`**。

---

### 方式一:一条命令(推荐)

```powershell
dsh plugin --profile web add "<插件文件夹或 .tgz 的绝对路径>"
```

例如:

```powershell
dsh plugin --profile web add "D:\dsh-plugins\dsh-plugin-balance-pet"
# 或者
dsh plugin --profile web add "D:\dsh-plugin-balance-pet-1.1.0.tgz"
```

**它自动做了三件事**(不需要你手改任何文件):

1. 把包装进 `<profile>\node_modules\`
2. 因为本包声明了 `dsh.bundle.patch`,自动把它追加进 `<profile>\package.json` 的 `dsh.profile.bundles`
3. 加载器条目由**本包自带的 `cordis.patch.yml`** 提供

#### 如果报 `pnpm failed` / `'pnpm' is not recognized`

说明 PATH 里没有 pnpm(一键版自带但没配)。先临时加进 PATH:

```powershell
$pnpm = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
# 一键版也可能是:
# $pnpm = "<安装目录>\data\dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs"

# 造一个临时 shim,让 dsh plugin 能找到 pnpm
$shim = "$env:TEMP\pnpm-shim"
New-Item -ItemType Directory -Force -Path $shim | Out-Null
$node = (Get-Command node).Source
Set-Content "$shim\pnpm.cmd" "@echo off`r`n`"$node`" `"$pnpm`" %*" -Encoding ASCII
$env:Path = "$shim;$env:Path"

# 然后重跑安装命令
dsh plugin --profile web add "D:\dsh-plugins\dsh-plugin-balance-pet"
```

装完可以用 `Get-Content` 检查一下是否登记成功:

```powershell
Get-Content "<DSH_HOME>\profiles\web\package.json"
# 期望看到 "dsh-plugin-balance-pet" 出现在 dependencies 和 dsh.profile.bundles 里
```

---

### 方式二:手工接线(没有 pnpm 时)

只需两步,不碰 `package.json`。

**第 1 步:让加载器能找到这个包**

加载器用 `import('dsh-plugin-balance-pet')` 解析,相对 profile 目录查找,所以要在
profile 的 `node_modules` 里放一个目录联接(junction):

```powershell
$profileDir = "<DSH_HOME>\profiles\web"
$pluginDir  = "D:\dsh-plugins\dsh-plugin-balance-pet"

New-Item -ItemType Directory -Force -Path "$profileDir\node_modules" | Out-Null
New-Item -ItemType Junction -Path "$profileDir\node_modules\dsh-plugin-balance-pet" -Target $pluginDir
```

验证:

```powershell
Test-Path "$profileDir\node_modules\dsh-plugin-balance-pet\lib\client.js"    # 应为 True
```

**第 2 步:加一行加载器条目**

编辑 `<profile>\cordis.patch.yml`,内容改成(或追加):

```yaml
- insert:
    - id: balance-pet
      name: dsh-plugin-balance-pet
```

> ⚠️ **两个致命细节**:
> 1. 文件**不能带 UTF-8 BOM**。用 PowerShell 的 `Set-Content -Encoding UTF8` 会加 BOM,
>    DSH 启动会直接报 `must be a top-level YAML array of loader patch entries`。
>    用记事本/VS Code 存成「UTF-8 无 BOM」,或直接用下面这段:
>
>    ```powershell
>    [IO.File]::WriteAllText("$profileDir\cordis.patch.yml",
>      "- insert:`n    - id: balance-pet`n      name: dsh-plugin-balance-pet`n")
>    ```
> 2. **不要**去改 `<profile>\package.json` 加 `link:` 依赖 —— 链接一旦失效,
>    DSH 下次启动会直接失败(`ERR_MODULE_NOT_FOUND`)。保持 `dependencies` 为空最安全。

---

## 3. 配置 DeepSeek API Key

插件读的是 **DSH 自己的凭据库**,不需要单独"导入账号":

```
<DSH_HOME>\.credentials.yaml
  refs:
    DEEPSEEK_API_KEY: sk-xxxxxxxx
```

三种写入方式,任选一种:

| 方式 | 怎么做 |
| --- | --- |
| **图形界面(推荐)** | DSH 网页 → 左下角 **设置 → 模型** → DeepSeek 卡片填 API Key 保存 |
| **改文件** | 编辑 `<DSH_HOME>\.credentials.yaml`,把 `DEEPSEEK_API_KEY:` 后面换成你的 key。DSH 监听该文件,**存盘即生效** |
| **环境变量** | 启动 DSH 前设 `DEEPSEEK_API_KEY`。优先级最高,会**遮蔽**文件里的值 |

验证 key 是否可用(只查余额,不消耗额度):

```powershell
curl.exe -s -H "Authorization: Bearer sk-你的key" https://api.deepseek.com/user/balance
# 期望:{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"23.21",...}]}
```

---

## 4. 重启 DSH

**必须重启** —— 插件是在启动时挂载的。

- 一键版:关掉窗口,重新运行 `开始安装.cmd` 或 `scripts\start-web.ps1`
- 源码版:重跑 `dsh web`

重启后打开 `http://127.0.0.1:3080`,**左下角**应该出现看板娘。

> 首次加载如果显示旧样式,按 **Ctrl+Shift+R** 硬刷新一次。

---

## 5. 验证安装成功

### 5.1 看启动日志

启动时正常会打印两行:

```
balance-pet: routes ready (4/4)
balance-pet: ready (sprite 77974 bytes)
```

### 5.2 直接请求路由

```powershell
# 1) 配置(资产版本号 + 谷价窗口 + 全年全天谷价日期表,不含任何 key)
curl.exe -s http://127.0.0.1:3080/balance-pet/config
# 期望:{"assetVersion":"28",...,"allDayValley":[["2026-01-01","2026-01-03"],...]}

# 2) 状态(余额 + 价段 + 下次切换时刻)
curl.exe -s http://127.0.0.1:3080/balance-pet/status
# 期望:{"valley":true,"label":"梁文谷","nextSwitchAt":1791388800000,"ok":true,"balance":23.21,...}

# 3) 底图
curl.exe -s -o nul -w "%{http_code} %{size_download}\n" http://127.0.0.1:3080/balance-pet/sprite
# 期望:200 77974
```

> `assetVersion` 不是 `28` 说明加载的还是旧的 `lib/`(没重启 DSH,或者装的是旧包)。

### 5.3 界面上看

看板娘出现在**左下角**,平板玻璃区内三行:

```
梁文谷 / 梁文峰      ← 谷价绿 / 峰价蓝
¥ 23.21              ← 恒白
158:47:24            ← 倒计时,染的是它数向的价段(指向谷=绿,指向峰=蓝)
```

> 名字跟当前价段,倒计时跟**它数向的**价段,所以两者颜色正好相反。

---

## 6. 怎么用

### 6.1 三行字分别是什么

| 行 | 内容 | 颜色规则 |
| --- | --- | --- |
| 第一行 | `梁文谷` / `梁文峰` —— **当前**价段的称呼 | 谷价绿 `#5cf07f`,峰价蓝 `#9ad7ff` |
| 第二行 | `¥ 23.21` —— 剩余余额,两位小数,千分位带逗号 | **恒白**,不参与变色 |
| 第三行 | `158:47:24` —— 距离**下一次峰谷切换**还剩多久 | 染**它数向的那个价段**的色:指向谷=绿,指向峰=蓝 |

第三行颜色和第一行**永远相反**:现在显示谷价,名字是绿的、倒计时是蓝的(它在等峰价)。
反过来也一样。**所以只要一眼扫两行颜色,就知道现在是什么价、下一个是什么价。**

### 6.2 时间格式

`小时:分钟:秒`,**小时不进位成天**:

| 情况 | 显示 |
| --- | --- |
| 当天还要 2 小时 19 分 34 秒 | `02:19:34` |
| 国庆连休(约 6 天半) | `158:47:24` |
| 春节连休(最长) | `246:31:07` |

倒计时每秒自己走一格,余额和价段则每 3 秒找 Host 要一次新数据。

### 6.3 鼠标操作

| 操作 | 效果 |
| --- | --- |
| **按住左键拖动** | 她跟着鼠标走,松手就停在原地。拖动过程**没有任何动画**(早先版本会晃/会弹,都去掉了) |
| **左键点一下**(不拖动) | 上下压扁、左右变宽的橡皮回弹效果,不是跳起来 |
| 悬停 | 光标变成抓取状 |

位置在**首次拖动时**才从 CSS 的左下角锚定转成具体像素坐标,之后一直跟着浏览器窗口,
除非你把它拖到窗口外面(会被限制在可视范围内)。

### 6.4 头顶的提示

| 你看到 | 含义 |
| --- | --- |
| 红色 `-¥0.30` 往上飘 | **扣款了**:余额比上一次查询少了 0.30 |
| 粉色 `❤` 往上飘 | **到账了**:余额比上一次查询多了 |

判断阈值是 0.005 元,所以浮点误差不会乱触发。

### 6.5 正常情况下它多久变一次

| 内容 | 频率 |
| --- | --- |
| 倒计时 | 每 **1 秒** |
| 余额 / 价段 | 每 **3 秒**向 Host 问一次;Host 侧对上游的真实查询最快 **5 秒**一次,所以实际是 **3~8 秒** |
| 价段翻面的精确度 | 倒计时归零会**立刻**补一次请求,所以切换后 1 秒内就翻面 |

> DeepSeek 的余额接口自己有约几秒的服务端延迟,所以调得再快也不会更及时。

### 6.6 出问题时平板上会显示什么

| 平板显示 | 含义 | 怎么办 |
| --- | --- | --- |
| 第三行 `--:--:--`、余额 `¥ --` | 一条快照都还没拿到 | 硬刷新;**并确认 DSH 重启过**(见第 4 步) |
| 查询失败 + 一行小字 | 拿到过,但最近一次查询失败,小字是原因 | 已拿到的余额会保留显示,不用管;持续失败按小字排查 |
| 平板下方黄字 `快照读取失败:` | 连 `/balance-pet/status` 都请求不到 | 说明 Host 半没挂上,回去看第 5.1 的启动日志 |

---

## 7. 卸载

```powershell
$profileDir = "<DSH_HOME>\profiles\web"

# 方式一装的:
dsh plugin --profile web remove dsh-plugin-balance-pet

# 或手工:删掉 patch 里的那行 + 删掉联接
Remove-Item "$profileDir\node_modules\dsh-plugin-balance-pet" -Recurse -Force
# 再把 cordis.patch.yml 里的 - insert: 那段删掉
```

重启生效。

---

## 8. 故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| DSH **完全打不开**,日志有 `must be a top-level YAML array of loader patch entries` | `cordis.patch.yml` 带了 **UTF-8 BOM** | 重存为「UTF-8 无 BOM」 |
| 启动报 `Cannot find package 'dsh-plugin-balance-pet'` | `node_modules` 里没有联接,或联接失效 | 重建 junction(方式二第 1 步) |
| 日志有 `ready` 但路由 **404** | 插件没声明 `inject: ['webServer']`(本插件**已声明**,一般是别的原因) | 确认用的是本包,不是自己改过的版本 |
| 平板始终 `--:--:--` / `¥ --` | 浏览器半没导出 `inject`(本插件**已导出**) | 同上;或硬刷新拿新脚本 |
| 显示「未配置 DEEPSEEK_API_KEY」 | key 没配好 | 回到第 3 步 |
| 显示「查询失败: HTTP 401」 | key 无效或已过期 | 重新生成 key |
| 看板娘不出现,但日志正常 | 页面跑的是缓存的旧脚本 | **Ctrl+Shift+R** 硬刷新 |
| 显示旧样式(位置/字号不对) | 同上,样式被缓存 | 硬刷新;样式接口已带 `no-cache` + 版本号 |
| **第三行变成没样式的裸字 / 位置全乱** | **改了 `lib/` 之后只刷新页面、没重启 DSH**:浏览器拿到的是**新脚本**,而 Host 还在用启动时读进内存的**旧样式表** | 重启 DSH(样式表是在 `apply()` 时读一次、之后一直用内存里的那份) |
| 余额不更新 | 网络到 `api.deepseek.com` 不通 | 在目标机上单独测第 3 步的 curl |

---

## 9. 附录:这台电脑(已完成)的实际路径参考

供对照,目标机路径可能不同:

| 项目 | 本机值 |
| --- | --- |
| `DSH_HOME` | `D:\deepseek harness\Deepseekharnessoneclickinstall-main\data\dsh` |
| profile 目录 | `...\data\dsh\profiles\web` |
| 插件联接 | `...\profiles\web\node_modules\dsh-plugin-balance-pet` → `C:\Users\zoufeng\Desktop\github\dsh-plugin-balance-pet` |
| 加载器条目 | `...\profiles\web\cordis.patch.yml` |
| 凭据文件 | `...\data\dsh\.credentials.yaml` |
| 启动脚本 | `...\scripts\start-web.ps1` |
