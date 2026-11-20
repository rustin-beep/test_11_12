# 作业管理系统(原生 TypeScript,零运行时依赖)

学生提交作业(文件/文本,带实时倒计时与逾期判定)、教师发布作业、管理多班名单、自动统计缺交、批阅打分、简版查重、CSV 导入导出。

**技术栈**:前端 Vite + 原生 TS(无框架);后端 Node.js 内置模块(`node:http` + `node:sqlite` + `node:crypto`),**运行时 npm 依赖 = 0**。Node ≥ 22.5(建议 22 LTS+),Windows 单机可直接跑。

## 快速开始(Windows 单机)

1. 安装 [Node.js 22+](https://nodejs.org);
2. 双击 `start.bat`(首次自动装构建依赖并构建前端,之后直接启动);
3. 浏览器打开 `http://localhost:8080`,默认教师账号 **teacher / 123456**(请改密)。

**账号规则**:学生账号 = 学号,初始密码 = 学号(由教师导入班级名单时自动开通);忘记密码由教师在「班级名单 → 重置密码」重置为学号。

数据文件在 `data/homework.db`(备份=复制),上传文件在 `uploads/`。

## 开发模式(前后端分离)

```bash
npm run dev:server   # 后端 API, http://localhost:8080(--watch 热重载)
npm run dev:web      # 前端 Vite, http://localhost:5173(代理 /api → 8080)
```

## 测试与检查

```bash
npm test             # node:test:单元 + API 集成(21 个用例,零额外依赖)
npm run typecheck    # 前后端 TS 类型检查
```

覆盖的关键场景:截止边界与补交窗口、逾期提交 403、**并发重复提交只落一条**(UNIQUE 约束)、覆盖重交(attempt+1,历史留档)、教师改截止(version++ → 学生端复活)、统计缺交名单、批阅学生可见、相同文件查重、CSV BOM 导出、越权访问 403。

## 部署到网站

### 形态一:一个网站(推荐)

后端进程本身就是静态服务器——一个端口/域名同时提供 API 和页面,**无需任何配置**:

```bash
npm run build          # 构建 web/dist
node server/main.ts    # http://localhost:8080
```

学生和教师用同一网站下的**不同网址入口**:

- 学生端:`http://你的域名/student`(或 `http://你的域名/#/student`)
- 教师端:`http://你的域名/teacher`(或 `http://你的域名/#/teacher`)

未登录访问入口会先到登录页,登录后按角色自动进入对应端;角色与入口不符会被自动导向正确端(如教师打开学生链接会进入教师端)。

### 形态二:前端静态托管 + 远程 API(仅当没有可跑 Node 的机器时)

```bash
cd web
VITE_API_BASE=https://你的后端地址 npm run build   # 产物在 web/dist,扔任意静态托管
node server/main.ts                                 # 后端跑在任意 Node 环境(CORS 已放开)
```

> 注意:API 无法"静态部署"——数据库、文件存储、逾期判定都是运行时逻辑,纯静态托管(如 GitHub Pages)只能承载前端页面,后端进程必须跑在能执行 Node 的环境(服务器/VPS/本机)。

## 功能说明

### 学生端
- 作业列表:实时倒计时(以**服务器时间**为基准,改本机时间无效);>1h 绿 / ≤1h 橙 / ≤10min 红+脉冲 / ≤0 灰标"已逾期";
- 临近截止(≤10 分钟)未交:横幅 + 系统通知 + 提示音(每作业一次);
- 提交:文件(≤8MB)或文本,截止前可覆盖重交(次数+1,旧版本留档);逾期禁止,补交期内可交但标"逾期提交";
- 查看:作业详情、我的提交、历史版本、教师批阅的分数与评语、下载自己的文件。

### 教师端
- 多班级:建班/删班、手动加学生、CSV 批量导入(`学号,姓名[,密码]`,含模板下载);
- 发布/编辑作业:标题、说明、截止时间、是否允许补交及补交截止、提交类型(文件/文本/均可);
- 修改截止时间:保存后 `version+1`,学生端 ≤30 秒自动刷新;延长截止时已逾期作业恢复可提交;
- 统计:应交/按时/逾期已交/未交/已批五档数字,缺交名单醒目列出,可一键导出 CSV(带 BOM,Excel 直接打开);
- 批阅打分 + 评语;简版查重:相同文件(MD5)分组 + 文本相似(Simhash 海明距离 ≤4)标注疑似互抄;
- 下载任意学生提交的文件。

### 关键设计
- **时间**:全部 UTC 毫秒存储;判定只在服务端做(防本地改时间);前端经 `X-Server-Time` 响应头校准时钟;
- **重复提交**:`UNIQUE(assignment_id, student_id)` + UPSERT,并发下也只会有一条记录;
- **鉴权**:scrypt 密码哈希 + HMAC-SHA256 签名 token(均 `node:crypto` 内置);角色(teacher/student)接口隔离;
- **共享类型**:`shared/types.ts` 同时被前后端引用(含 `submitWindow` 截止窗口纯函数),字段改名编译期即报错。

## 目录结构

```
server/   后端(node:http 路由 + node:sqlite,零依赖)
  main.ts       入口(端口/密钥/种子教师)
  server.ts     全部 API 路由 + 静态托管
  db.ts         建表(多班/作业/提交/历史)
  auth.ts       scrypt + HMAC token
  util/csv.ts       CSV 解析/生成(BOM)
  util/simhash.ts   文本指纹查重
shared/   前后端共享类型与纯函数
web/      前端(Vite + 原生 TS,hash 路由)
  src/pages/         登录/学生列表/学生详情/教师作业/教师名单/教师统计
  src/components/    倒计时、顶栏
  src/lib/           时间格式化、页面定时器
tests/    node:test 单元 + API 集成测试
start.bat 一键启动(单机模式)
```
