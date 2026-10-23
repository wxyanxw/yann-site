# Git 常用指令速查表

针对本项目（纯静态个人网站，GitHub + Vercel 部署）整理。命令在 PowerShell / 终端里执行。

---

## 一、首次配置（只用一次）

```powershell
# 查看 Git 版本
git --version

# 设置提交时显示的身份（换成你自己的）
git config --global user.name "wxyanxw"
git config --global user.email "你GitHub已验证的邮箱"

# 让终端输出带颜色，更易读（可选）
git config --global color.ui auto

# 记住凭据，避免每次推送都登录（可选）
git config --global credential.helper manager
```

---

## 二、初始化与远程（首次推送用）

```powershell
# 进入项目目录
cd e:/personal-site

# 初始化本地仓库
git init

# 添加 .gitignore 和所有文件到暂存区
git add .
# 或只加某个文件：git add index.html

# 首次提交
git commit -m "initial commit"

# 关联远程仓库（你的远程叫 yann-site，不是 origin）
git remote add yann-site https://github.com/wxyanxw/yann-site.git

# 把默认分支改名为 main
git branch -M main

# 首次推送并设定上游（-u 之后直接 git push 即可）
git push -u yann-site main
```

> 远程名字说明：你本地远程名叫 `yann-site`，所以命令里用 `yann-site` 而不是 `origin`。

---

## 三、日常更新（改完代码推上去）

```powershell
# 1. 看当前改了哪些文件
git status

# 2. 把改动加入暂存区
git add .

# 3. 提交（写清楚改了什么）
git commit -m "update: 修改简介和链接"

# 4. 推送到 GitHub（Vercel 会自动重新部署）
git push
```

> 设过上游后，`git push` 会自动推到 `yann-site/main`，不用再写全名。

---

## 四、查看与对比

```powershell
# 查看工作区状态（哪些改了/没暂存）
git status

# 查看具体改了哪些内容
git diff

# 查看提交历史（一行一条）
git log --oneline

# 查看最近 5 条提交
git log -5 --oneline

# 查看远程仓库信息
git remote -v

# 查看当前分支
git branch
```

---

## 五、远程仓库管理

```powershell
# 查看所有远程（名字 + 地址）
git remote -v

# 修改某个远程的 URL（地址填错了/换仓库时用）
git remote set-url yann-site https://github.com/wxyanxw/新仓库名.git

# 重命名远程（比如 yann-site 改成 origin）
git remote rename yann-site origin

# 删除某个远程
git remote remove yann-site

# 从远程拉取最新代码（下载并合并）
git pull
```

---

## 六、分支基础

```powershell
# 查看所有分支（当前分支前有 *）
git branch

# 新建分支
git branch dev

# 切换到某分支
git switch dev
# 或老写法：git checkout dev

# 新建并切换（一步到位）
git switch -c dev

# 切回主分支
git switch main

# 把 dev 的改动合并回 main（先切到 main 再合并）
git switch main
git merge dev

# 删除已合并的分支
git branch -d dev
```

---

## 七、撤销与回退（小心使用）

```powershell
# 撤销某个文件的暂存（还在工作区，改动保留）
git restore --staged index.html

# 丢弃某个文件的工作区改动（慎用，不可恢复）
git restore index.html

# 回退到上一次提交（保留改动到工作区）
git reset --soft HEAD~1

# 回退到上一次提交（丢弃改动，慎用）
git reset --hard HEAD~1
```

> `--hard` 会永久丢失未提交的改动，使用前确认无误。

---

## 八、常见问题速查

| 场景 | 命令 |
| --- | --- |
| 忘了远程地址 | `git remote -v` |
| 推不上去提示无上游 | `git push -u yann-site main` |
| 远程名字用错了 | `git remote rename 旧名 新名` |
| 想重新关联远程 | `git remote remove 名` 再 `git remote add ...` |
| 本地落后远程 | `git pull` 先拉再推 |
| 推送要反复登录 | 装 `gh` 并 `gh auth login` + `gh auth setup-git` |

---

## 九、你的项目标准流程（记住这条就够）

```powershell
cd e:/personal-site
git add .
git commit -m "描述这次改了什么"
git push
```

推完等 10–30 秒，刷新你的域名就能看到更新。
