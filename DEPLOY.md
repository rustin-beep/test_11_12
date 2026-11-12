# 部署指南

## 方式一:静态演示版(国内免费托管,推荐作业展示)

`npm --prefix web run build:demo` 产物即为**纯静态演示版**:后端逻辑(登录、提交、逾期判定、统计、查重、批阅)全部编译进浏览器,数据存 localStorage/IndexedDB,同一浏览器的多个标签页共享数据(学生标签提交,教师标签 ≤30 秒可见)。**任意静态托管直接可用**,国内访问无门槛。

限制(如实标注,登录页已有提示):数据仅存于当前浏览器,换设备/浏览器不共享;清除浏览器数据即重置(重新打开自动重建 60 人班 + 4 作业种子)。

发布到花生壳文件托管(已绑定账号,发布即长期):

```bash
npm --prefix web run build:demo
hsk-cli file-hosting web/dist --entry-file index.html --format json
```

## 方式二:完整后端版(真实多设备共享)

系统含 Node 后端,需要能跑 Node 的环境:

### Render.com 免费层(需科学上网管理,国内访问质量不稳定)

## 步骤(约 10 分钟,一次性)

1. **推代码到 GitHub**(本目录已 git 初始化):
   ```bash
   git add .
   git commit -m "作业管理系统"
   git remote add origin https://github.com/rustin-beep/homework-system.git
   git push -u origin main
   ```
2. 打开 [render.com](https://render.com) → 用 GitHub 账号登录 → **New + → Blueprint**;
3. 选中刚推的 `homework-system` 仓库 → Apply(仓库里的 `render.yaml` 会自动配置好一切);
4. 等构建完成(约 2 分钟),得到公网地址:`https://homework-system-xxxx.onrender.com`。

完成。此后每次 `git push`,平台自动重新部署。

## 免费层须知

- 15 分钟无人访问会休眠,**首次唤醒约 30 秒**(第一次打开慢属正常,后续正常);
- 免费层数据盘是临时的:重启后数据重置,但系统会自动重建种子数据(60 人班 + 4 个作业),展示永远可用;
- 演示期间提交的作业在休眠重启后会消失——正式收作业请用付费层(~$4/月,持久磁盘)或自有机房;
- 首次部署后建议:教师 `teacher/123456` 登录 → 立即改密(默认密码写在 README,是公开的)。

## 其他免费平台(同样的仓库直接用)

| 平台 | 说明 |
|---|---|
| Railway | 每月免费额度,连 GitHub 后选仓库,启动命令 `node server/main.ts` |
| Zeabur | 国内访问友好,免费额度有限 |
| Koyeb | 免费一个 web 服务 |

要求都一样:**Node ≥ 22.5**(系统用了内置 `node:sqlite`),启动命令 `node server/main.ts`,构建命令 `npm install && npm run build`。

## 备选:有 Windows 机器时的单机部署

用 `homework-deploy.zip`(101 KB):解压 → 装 Node 22+ → 双击 `start.bat`。适合"演示时我自己电脑开着"的场景,配合花生壳映射暴露公网。
