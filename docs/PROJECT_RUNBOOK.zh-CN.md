# SDRF Studio 项目运行手册

本文档记录 SDRF Studio 的项目结构、常用启动方式和本机运行注意事项。后续新对话处理本项目时，优先阅读本文件，再根据需要查看 `AGENT.md`、`README.md` 和各子项目配置文件。

## 项目概览

SDRF Studio 是一个面向内网使用的 SDRF 文件构建、审阅、校验和导出工具，主要服务蛋白质组学 SDRF-Proteomics v1.1.0 工作流。

项目是一个小型 monorepo：

- `apps/web`: React 18 + TypeScript + Vite + Tailwind，前端入口。
- `apps/api`: FastAPI + SQLAlchemy + Pydantic settings，后端入口。
- `docker-compose.yml`: Docker 方式启动 web、api、PostgreSQL、Redis。
- `storage/` 和 `apps/api/storage/`: 本地上传、导出等运行时文件。
- `sdrf_studio.db` 和 `apps/api/sdrf_studio.db`: 本地 SQLite 运行时数据库文件。

默认端口：

- 前端 Vite: `http://localhost:5173`
- 后端 API: `http://localhost:8000`
- API 健康检查: `http://localhost:8000/api/health`

## 推荐本地启动方式

### 1. 启动后端 API

推荐从 `apps/api` 目录启动后端，这样后端会使用默认 SQLite 配置，避免读取仓库根目录 `.env` 中为 Docker 准备的 `db:5432` PostgreSQL 地址。

```powershell
cd E:\bigbio\sdrf-studio\apps\api
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

开发时如果需要自动重载，可以前台运行：

```powershell
cd E:\bigbio\sdrf-studio\apps\api
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

也可以使用 `uv`：

```powershell
cd E:\bigbio\sdrf-studio\apps\api
uv run python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动后验证：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8000/api/health
```

期望返回：

```json
{"status":"ok"}
```

### 2. 启动前端 Web

```powershell
cd E:\bigbio\sdrf-studio\apps\web
npm run dev
```

如果依赖缺失，先运行：

```powershell
cd E:\bigbio\sdrf-studio\apps\web
npm install
```

启动成功后打开：

```text
http://localhost:5173
```

前端 API 地址由 `VITE_API_BASE_URL` 控制，默认指向 `http://localhost:8000`。

## Docker 启动方式

Docker 方式会使用 `docker-compose.yml` 启动前端、后端、PostgreSQL 和 Redis。

```powershell
cd E:\bigbio\sdrf-studio
docker compose up --build
```

Docker 模式会读取仓库根目录 `.env` 中的配置，其中 `DATABASE_URL=postgresql+psycopg://...@db:5432/...` 是容器网络内地址，只适合 Docker Compose 服务互连。

## 本机 Codex 后台启动记录

在 Codex Desktop 的 Windows 环境中，普通沙箱命令启动的后台进程可能在命令结束后被清理。需要让服务持续运行时，使用沙箱外 `Start-Process` 启动。

本机已验证可用的后台启动思路：

```powershell
$api = Start-Process -FilePath "D:\ProgramFiles\Anaconda\python.exe" `
  -ArgumentList @("-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8000") `
  -WorkingDirectory "E:\bigbio\sdrf-studio\apps\api" `
  -RedirectStandardOutput "E:\bigbio\sdrf-studio\apps\api\backend.stdout.log" `
  -RedirectStandardError "E:\bigbio\sdrf-studio\apps\api\backend.stderr.log" `
  -WindowStyle Hidden `
  -PassThru

$web = Start-Process -FilePath "D:\ProgramFiles\Nodejs\npm.cmd" `
  -ArgumentList @("run","dev") `
  -WorkingDirectory "E:\bigbio\sdrf-studio\apps\web" `
  -RedirectStandardOutput "E:\bigbio\sdrf-studio\apps\web\vite-dev.out.log" `
  -RedirectStandardError "E:\bigbio\sdrf-studio\apps\web\vite-dev.err.log" `
  -WindowStyle Hidden `
  -PassThru
```

注意：

- `--reload` 后台模式在 Codex 沙箱中可能不稳定；需要稳定后台服务时，API 可先不加 `--reload`。
- 当前环境曾出现同时存在 `Path` 和 `PATH` 两个环境变量键，导致 `Start-Process` 报 `Item has already been added. Key in dictionary: 'Path'`。遇到该错误时，先在当前 PowerShell 进程中执行：

```powershell
[Environment]::SetEnvironmentVariable('PATH',$null,'Process')
```

- 不要把真实 `.env` 内容或 API key 写入对话、日志或文档。

## 停止本地服务

查看端口占用：

```powershell
netstat -ano | findstr ":8000"
netstat -ano | findstr ":5173"
```

按 PID 停止：

```powershell
Stop-Process -Id <API_PID>,<WEB_PID> -Force
```

如果是当前已启动的这组服务，曾验证的监听 PID 为：

```powershell
Stop-Process -Id 1584,9536 -Force
```

后续启动时 PID 可能变化，应优先用 `netstat` 重新确认。

## 常用测试和构建

后端测试：

```powershell
cd E:\bigbio\sdrf-studio\apps\api
pytest
```

或从仓库根目录：

```powershell
cd E:\bigbio\sdrf-studio
npm run test:api
```

前端构建：

```powershell
cd E:\bigbio\sdrf-studio\apps\web
npm run build
```

前端测试：

```powershell
cd E:\bigbio\sdrf-studio\apps\web
npm run test
```

## 重要注意事项

- 本地非 Docker 后端推荐从 `apps/api` 启动，否则可能读取仓库根目录 `.env` 并尝试连接 Docker 专用主机名 `db`。
- 根目录 `.env` 可能包含真实密钥，禁止复制到回复或提交。
- `storage/`、`apps/api/storage/`、`sdrf_studio.db`、`apps/api/sdrf_studio.db` 都是运行时数据，除非用户明确要求，不要删除。
- 前端请求封装在 `apps/web/src/api.ts`。
- 后端路由主要在 `apps/api/app/main.py`。
- SQLAlchemy 模型在 `apps/api/app/models.py`，Pydantic schema 在 `apps/api/app/schemas.py`。
- SDRF 解析、校验和导出逻辑在 `apps/api/app/services/sdrf.py`。

