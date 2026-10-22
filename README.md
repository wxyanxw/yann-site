# 个人网站（最小可跑通版 / Plan B）

纯静态 `index.html`，零依赖、零构建，Vercel 直接托管。
本地改完 `index.html` 推到 GitHub，再到 Vercel 导入即可。

## 本地预览
直接用浏览器打开 `index.html` 就能看效果。

## 推到 GitHub（一次性）
1. 在 https://github.com/new 新建一个空仓库（比如 `personal-site`），
   **不要**勾选自动生成 README / .gitignore。
2. 在本项目目录执行（把仓库地址换成你自己的）：

   ```bash
   git remote add origin https://github.com/wxyanxw/personal-site.git
   git branch -M main
   git push -u origin main
   ```

## 在 Vercel 部署（绑定 GitHub）
1. 打开 https://vercel.com/wxyanxw-dev → **Add New → Project**。
2. 在 **Import Git Repository** 里选你刚推送的 `personal-site` 仓库。
3. Framework Preset 选 **Other**（纯静态，无需构建），直接点 **Deploy**。
4. 几秒后拿到 `xxx.vercel.app` 临时域名，先确认能打开。

## 绑定自己的域名
1. 项目里进 **Settings → Domains**，输入你买的域名
   （建议同时加 `你的域名.com` 和 `www.你的域名.com`）。
2. 按 Vercel 提示去域名注册商配 DNS，二选一：
   - **推荐：改 Nameserver** 为 Vercel 提供的两个
     （如 `ns1.vercel-dns.com` / `ns2.vercel-dns.com`），之后全自动。
   - **或手动加解析**：根域名 A 记录指向 `76.76.21.21`，
     `www` 用 CNAME 指向 `cname.vercel-dns.com`。
3. 等 DNS 生效（几分钟到几十分钟），用你的域名访问即可，SSL 自动签发。

## 之后怎么改
直接编辑 `index.html` → `git add . && git commit -m "update" && git push`，
Vercel 会自动重新部署。
