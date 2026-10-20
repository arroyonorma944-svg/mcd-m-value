# 推送操作说明

## 现状

本地仓库已经全部准备好：5 个提交，12 个文件，分支 `main`，远程地址已配置。

**唯一缺的是 GitHub 授权。** 这台机器上的 PortableGit 不带任何图形化认证组件（无 Git Credential Manager、无 askpass、无 wincred），所以无法弹出登录窗口，只能由你在交互式终端里输入一次凭据。

---

## 方式一：双击脚本（推荐）

在文件资源管理器里进入 `mcd-contest\mcd-m-value\`，然后：

**右键 `推送.ps1` → 使用 PowerShell 运行**

如果右键菜单没有这一项，打开 PowerShell 窗口，粘贴执行：

```powershell
cd "C:\Users\Administrator\WorkBuddy\2026-10-18-15-52-50\mcd-contest\mcd-m-value"
powershell -ExecutionPolicy Bypass -File .\推送.ps1
```

---

## 方式二：手动执行三条命令

打开 PowerShell，逐条粘贴：

```powershell
cd "C:\Users\Administrator\WorkBuddy\2026-10-18-15-52-50\mcd-contest\mcd-m-value"

& "C:\Users\Administrator\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe" push -u origin main
```

执行后会提示输入：

| 提示 | 该填什么 |
|---|---|
| `Username for 'https://github.com'` | `arroyonorma944-svg` |
| `Password for 'https://arroyonorma944-svg@github.com'` | **Personal Access Token**（`ghp_` 开头的一串），不是你的 GitHub 登录密码 |

---

## 没有 Token？先花 1 分钟生成

GitHub 从 2021 年起就不接受账号密码做 Git 操作，必须用 Token。

1. 打开 https://github.com/settings/tokens/new?scopes=repo&description=mcd-m-value
2. **Note** 随意填，比如 `mcd-m-value`
3. **Expiration** 选 30 days
4. 权限只勾最上面那一项 **`repo`**（勾整项即可，子项会自动选中）
5. 拉到底点 **Generate token**
6. 复制页面顶部那串 `ghp_xxxxxxxx` —— **只显示这一次，关掉就看不到了**

拿到后回到 PowerShell，粘到 Password 处（粘贴时屏幕上不显示字符，是正常的）。

---

## 推送成功后

### 1. 开启 GitHub Pages

打开 https://github.com/arroyonorma944-svg/mcd-m-value/settings/pages

- **Source** 选 `Deploy from a branch`
- **Branch** 选 `main`，目录选 `/ (root)`
- 点 **Save**

等 1–2 分钟，访问：

```
https://arroyonorma944-svg.github.io/mcd-m-value/
```

**这一步不能省。** README 顶部已经写死了这个链接，页面不生效的话点进去是 404，会直接影响 Star 转化。

### 2. 提交报名 Issue

打开 https://github.com/M-China-Official/mcd-developer-innovation-challenge/issues/new

正文严格复制下面这段（**标题和正文之间不要换行，地址不要用 Markdown 链接**）：

```
【参赛申请】
项目名称：麦值 M-Value · 麦当劳浓度检测器
项目地址：https://github.com/arroyonorma944-svg/mcd-m-value
项目简介：读取麦当劳历史订单，用一个 0-100 的 M 值量化你对金拱门的浓度，五维加权评分 + 等级判定 + 钠摄入估算，全部基于 MCP order-list 真实数据
```

标题随意，例如：

```
【参赛申请】麦值 M-Value · 麦当劳浓度检测器
```

提交后系统会在 Issue 下自动回复是否报名成功。失败会说明原因，按提示改完重新提交即可。

---

## 常见报错

| 报错 | 原因 | 解决 |
|---|---|---|
| `Authentication failed` | Password 填了登录密码 | 换成 Personal Access Token |
| `Support for password authentication was removed` | 同上 | 同上 |
| `repository not found` | 仓库没建，或用户名拼错 | 确认 https://github.com/arroyonorma944-svg/mcd-m-value 能打开 |
| `! [rejected] main -> main (fetch first)` | 远程有你不知道的提交 | 执行 `git pull --rebase origin main` 后再推 |
| `unable to access ... 443` | 网络问题 | 检查代理；或改用 SSH 方式 |

---

## 为什么我不能代劳

GitHub 授权必须由账号持有者在交互式终端完成。当前环境下：

- 没有 `gh` CLI（无法用 `gh auth login`）
- PortableGit 无 Git Credential Manager（无法弹窗）
- 无 `askpass`（无法弹出密码框）
- 无 `wincred`（无法读 Windows 凭据库）

四条路都不通，所以只能你手动输一次。输完凭据会存进 Windows 的临时存储，后续推送就不用再输。
