@echo off
rem 一键启动(单机模式):自动安装构建前端 + 启动服务
rem 首次运行需已安装 Node.js 22+
cd /d %~dp0
where node >nul 2>nul || (echo [错误] 未检测到 Node.js,请先安装 Node 22+: https://nodejs.org & pause & exit /b 1)

if not exist web\dist (
  echo [初始化] 首次运行:安装构建依赖并构建前端(需要联网,仅一次)...
  if not exist web\node_modules call npm --prefix web install || (pause & exit /b 1)
  call npm --prefix web run build || (pause & exit /b 1)
)

echo.
echo ============================================================
echo   作业管理系统已启动: http://localhost:8080
echo   默认教师账号: teacher / 123456 (请尽快修改密码)
echo   数据文件: data\homework.db   上传文件: uploads\
echo   关闭本窗口或 Ctrl+C 即可停止服务
echo ============================================================
echo.
start http://localhost:8080
node server\main.ts
pause
