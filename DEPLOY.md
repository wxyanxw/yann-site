# 个人网站部署指南：GitHub + Vercel + 自有域名

本指南针对本项目（纯静态 `index.html`，零构建）的完整上线流程：
**本地 → GitHub 管理 → Vercel 部署 → 绑定自己的域名**。

你的账号信息（来自项目内容）：
- GitHub：`https://github.com/wxyanxw`
- Vercel：`https://vercel.com/wxyanxw-dev`

---

## 0. 前置准备

确认你已经具备以下条件：

- [ ] 本机已安装 [Git](https://git-scm.com/downloads)（命令行输入 `git --version` 有版本号即正常）
- [ ] 已注册 GitHub 账号（用户名 `wxyanxw`）
- [ ] 已注册 Vercel 账号（你给的是 `wxyanxw-dev`，即用该账号登录 https://vercel.com）
- [ ] 已经买好一个域名（在任意注册商，如阿里云、腾讯云、Namecheap、Cloudflare 等）
- [ ] 本机已安装代码编辑器（推荐 VS Code）

> 如果 Git 还没配过全局身份，先执行一次：
> ```bash
> git config --global user.name "wxyanxw"
> git config --global user.email "你的邮箱@example.com"
> ```

---

## 1. 在本地初始化 Git 仓库

项目目录 `e:/personal-site` 目前还没有被 Git 跟踪，先初始化：

```bash
# 进入项目目录（PowerShell / 终端）
cd e:/personal-site

# 初始化仓库
git init

# 把现有文件加入暂存区
git add .

# 首次提交
git commit -m "initial commit: static personal site"
```

> 可选：新建一个 `.gitignore`（本项目是纯静态，其实不需要，但建议留一个避免误提交编辑器缓存）：
> ```gitignore
> .DS_Store
> Thumbs.db
> *.log
> ```

---

## 2. 在 GitHub 新建仓库（一次性）

1. 打开 https://github.com/new
2. 填写：
   - **Repository name**：`personal-site`（或你喜欢的名字）
   - **Description**：可写 "My personal website"（可选）
   - **Visibility**：选 **Public**（公开；私有也行，Vercel 都能部署）
   - **不要**勾选 "Add a README file" / "Add .gitignore" / "Choose a license"，因为本地已经有内容了
3. 点击 **Create repository**

创建成功后，GitHub 会显示一个空仓库页面，里面有类似下面的命令（记下你的仓库地址）：

```
https://github.com/wxyanxw/personal-site.git
```

---

## 3. 把本地项目推送到 GitHub

回到本地终端，把本地仓库和 GitHub 关联并推送：

```bash
# 关联远程仓库（地址换成你刚才创建的）
git remote add origin https://github.com/wxyanxw/personal-site.git

# 把默认分支改名为 main（GitHub 现在默认用 main）
git branch -M main

# 首次推送并设定上游
git push -u origin main
```

> 如果提示要登录：
> - **GitHub 已开启 2FA** 的话，不能用账号密码，要用 **Personal Access Token (PAT)** 当密码。
>   去 https://github.com/settings/tokens 生成一个有 `repo` 权限的 token，推送时用户名填 `wxyanxw`，密码粘贴 token。
> - 更省事的方式：安装 [GitHub CLI](https://cli.github.com/) 后执行 `gh auth login`，之后推送免输密码。

刷新 GitHub 页面，应该能看到 `index.html` 和 `README.md` 已经上传。

---

## 4. 在 Vercel 导入 GitHub 仓库并部署

1. 打开 https://vercel.com/wxyanxw-dev 并用同一 Vercel 账号登录。
2. 首次使用可能需要 **授权 GitHub**（Install Vercel）：
   - 点击 **Add New → Project**（或 **New Project**）。
   - 在 **Import Git Repository** 区域，按提示 **Install Vercel for GitHub** / **Authorize**，选择要授权的范围（整个账号或指定仓库均可）。
   - 授权后就能看到你的 GitHub 仓库列表。
3. 在仓库列表里找到 `personal-site`，点击 **Import**。
4. 配置项目（**Framework Preset 选 Other**，因为是纯静态、无需构建）：
   - **Framework Preset**：`Other`
   - **Build Command**：留空（不需要）
   - **Output Directory**：留空或填 `.`（根目录就是 `index.html`）
   - **Install Command**：留空
5. 点击 **Deploy**。
6. 等待几十秒，状态变成 ✅ Ready，Vercel 会分配一个临时域名，类似：
   ```
   https://personal-site-xxx.vercel.app
   ```
   点开确认页面能正常显示，说明部署成功。

> 以后只要 `git push`，Vercel 会自动重新部署（默认 main 分支触发）。

---

## 5. 绑定你自己的域名

现在临时域名能用，但你想用自己的域名访问。

### 5.1 在 Vercel 添加域名
1. 进入刚部署的项目 → **Settings → Domains**。
2. 输入你买的域名，例如 `example.com`，点击 **Add**。
3. 建议**同时添加两个根域名**：
   - `example.com`（根域名 / apex）
   - `www.example.com`（子域名）
   Vercel 会帮你自动处理 `www` 跳转到根域名（或反过来，可在设置里选）。
4. 添加后 Vercel 会显示需要配置的 DNS 记录（记下它给的两条信息，下面要用）。

### 5.2 去域名注册商配置 DNS（二选一）

#### 方案 A（推荐）：把 Nameserver 改成 Vercel 的
最省心，SSL 证书自动续期，以后加子域名也全自动。
- Vercel 会给你两个 Nameserver，类似：
  ```
  ns1.vercel-dns.com
  ns2.vercel-dns.com
  ```
- 登录你买域名的注册商后台 → **DNS / 域名管理 → 修改 DNS / Nameserver**，
  把原来的 Nameserver 换成上面两个，保存。

#### 方案 B：手动加解析记录（不改 Nameserver）
如果你还想用原注册商的 DNS 管理：
- **根域名 `example.com`**：添加 **A 记录**，指向 `76.76.21.21`
- **`www.example.com`**：添加 **CNAME 记录**，指向 `cname.vercel-dns.com`

> 注意：不同注册商后台叫法不一，关键词一般是 "A 记录 / CNAME / 主机记录 / 记录值"。

### 5.3 等待生效
- DNS 全球生效通常需要 **几分钟到几十分钟**（最长可能 48 小时，但一般很快）。
- 在 Vercel 的 Domains 页面，状态从 `Invalid Configuration` 变成 `Valid Configuration` 即代表解析成功。
- **SSL 证书由 Vercel 自动签发**，无需手动申请；生效后用 `https://你的域名` 访问即可。

---

## 6. 之后的日常更新流程

以后想改网站内容（比如更新简介、加链接）：

1. 用编辑器修改 `index.html`（占位文字在 `index.html` 第 57–72 行附近）。
2. 提交并推送：
   ```bash
   git add .
   git commit -m "update: 修改简介和链接"
   git push
   ```
3. Vercel 监测到 main 分支更新，会**自动重新部署**，通常 10–30 秒后刷新域名就能看到新内容。

> 小技巧：每次部署 Vercel 都会生成一个预览链接，推送后可在项目面板的 **Deployments** 里查看构建日志和状态。

---

## 7. 常见问题排查

| 现象 | 可能原因 / 解决办法 |
| --- | --- |
| 推送时提示 `Authentication failed` | 开了 2FA，请用 PAT 当密码，或用 `gh auth login` |
| Vercel 里看不到 GitHub 仓库 | 没授权或授权范围不对，去 Vercel **Settings → Git** 重新 Install / 调整权限 |
| 域名状态一直是 `Invalid Configuration` | DNS 没生效或填错；核对 A 记录 / Nameserver，可用 `nslookup 你的域名` 检查 |
| 访问域名是 404 / 旧页面 | 确认 Vercel 项目的 **Output Directory** 是 `.`，且仓库根是 `index.html` |
| 改了代码但网站没变 | 确认已 `git push` 成功，且 Vercel Deployments 里有新的构建记录 |

---

## 8. 流程一览（速查）

```
本地改 index.html
   │ git add / commit / push
   ▼
GitHub (wxyanxw/personal-site)
   │ Vercel 监听到 push，自动拉取
   ▼
Vercel 部署 → 生成 xxx.vercel.app 临时域名
   │ 在 Settings → Domains 绑定
   ▼
自己的域名（DNS 指向 Vercel）→ 全球可访问 ✅
```

完成以上步骤，你的个人网站就正式上线并通过自己的域名访问了。🎉
