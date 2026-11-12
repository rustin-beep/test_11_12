@echo off
rem 部署包启动脚本(已含前端产物与初始数据,无需安装任何依赖)
rem 唯一要求:本机已安装 Node.js 22+(https://nodejs.org)
cd /d %~dp0
where node >nul 2>nul || (echo [错误] 未检测到 Node.js,请先安装 Node 22+: https://nodejs.org & pause & exit /b 1)

echo.
echo ============================================================
echo   作业管理系统已启动: http://localhost:8080
echo   局域网访问: http://本机IP:8080 (首次使用请放行防火墙)
echo.
echo   教师账号: teacher / 123456
echo   学生账号: 学号(202516026201~202516026260), 初始密码=学号
echo   班级: 电气工程及其自动化2025160262班(60人,含 4 份不同状态作业)
echo.
echo   数据文件: data\homework.db   提交文件: uploads\
echo   关闭本窗口或 Ctrl+C 即可停止服务
echo ============================================================
echo.
node server\main.ts
pause
