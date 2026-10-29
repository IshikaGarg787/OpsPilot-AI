# Local setup — Windows PowerShell

## Requirements

- Node.js 20 or newer and npm.
- Python 3.12 required for the two pinned runtimes. The delay-risk artifact runtime uses scikit-learn 1.6.1; keep it isolated from the resolution/workload environment.
- MongoDB running locally or reachable via `MONGODB_URI`. Docker Desktop can run the included local MongoDB service.

## Install

Run at the repository root:

```powershell
py -3.12 -m venv .venv312
.\.venv312\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r ml\requirements.txt
py -3.12 -m venv .venv-delayrisk
.\.venv-delayrisk\Scripts\python.exe -m pip install --upgrade pip
.\.venv-delayrisk\Scripts\python.exe -m pip install -r ml\requirements-delay-risk.txt
npm run install:all
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
```

The resolution/workload environment is `.venv312`; the delay-risk model uses a separate `.venv-delayrisk` environment because its artifact was serialized with scikit-learn 1.6.1. Both use Python 3.12. Use `py -3.12` explicitly because `python` may select another installed version.

Replace `SESSION_SECRET` in `server/.env` with a random secret. For example:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Do not commit `.env` files. Defaults are for local development only.

If npm reports blocked native install scripts, approve them from their package folders once:

```powershell
Push-Location server
npm install-scripts approve argon2
Pop-Location
Push-Location client
npm install-scripts approve esbuild
Pop-Location
```

The API defaults to `mongodb://127.0.0.1:27017/opspilot_ai` when `MONGODB_URI` is blank. Set it to your approved MongoDB URI to use a remote database.

## Start the local database

With Docker Desktop running, run this from the repository root:

```powershell
npm run db:up
```

This starts MongoDB on `127.0.0.1:27017` and waits for its health check. Data persists in a named Docker volume. `npm run db:down` stops the service and keeps that volume. If you use an existing MongoDB instance, skip these commands and set its address in `server/.env`.

## Environment variables

| File | Variable | Purpose |
|---|---|---|
| `server/.env` | `NODE_ENV` | Runtime environment; use `development` locally. |
| `server/.env` | `PORT` | Express port (default 5000). |
| `server/.env` | `CLIENT_ORIGIN` | Allowed browser origin(s), comma-separated. |
| `server/.env` | `MONGODB_URI` | Required for account, history, dashboard, and persistence. |
| `server/.env` | `ML_SERVICE_URL` | FastAPI base URL used by Express. |
| `server/.env` | `DELAY_RISK_SERVICE_URL` | Version-pinned delay-risk FastAPI service used by Express. |
| `server/.env` | `SESSION_SECRET` | HMAC key for opaque session tokens; required in production. |
| `server/.env` | `COOKIE_SECURE` | Set true when served over HTTPS. |
| `server/.env` | `ML_ARTIFACT_DIR` | Resolution metrics location read by the API registry. |
| `client/.env` | `VITE_API_BASE_URL` | Express API base URL. The workload page now reaches FastAPI through this authenticated proxy. |
| ML process | `ML_ARTIFACT_DIR` | Optional override for resolution artifacts; defaults to `ml/artifacts/resolution`. |
| ML process | `ML_MODEL_PATH` | Optional override for the saved resolution pipeline path. |

Only `VITE_*` values are exposed to the browser. Do not place secrets there. The workload page calls the authenticated Express proxy, so the browser no longer needs the FastAPI service URL or its CORS allowlist for the forecast workflow.

## Start services

Start MongoDB first. The simplest option is `npm run dev`, which starts the two model services, API, and web app together. For service-by-service troubleshooting, start four terminals in the repository root:

**Terminal 1 — ML service**

```powershell
.\.venv312\Scripts\python.exe -m uvicorn ml.resolution_api:app --reload --port 8000
```

**Terminal 2 — delay-risk model (isolated scikit-learn 1.6.1 runtime)**

```powershell
.\.venv-delayrisk\Scripts\python.exe -m uvicorn ml.delay_risk_service:app --reload --port 8001
```

**Terminal 3 — Express API**

```powershell
npm --prefix server run dev
```

**Terminal 4 — Web app**

```powershell
npm --prefix client run dev
```

Visit `http://localhost:5173`. The integrated ticket decision requires all three model services and MongoDB. Standalone workload forecasting uses a refreshed CSV, Express, and the main ML service; Express requires MongoDB for the authenticated session.

Public signup cannot create the Admin account. To provision the fixed workspace owner, set the temporary `ADMIN_PROVISION_*` values in `server/.env` using the checklist in `docs/database-architecture.md`, run `npm --prefix server run admin:provision`, remove the initial password and confirmation values afterward, and sign in with the owner account.

## Verify service state

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/forecast/health
Invoke-RestMethod http://localhost:8001/health
Invoke-RestMethod http://localhost:5000/api/v1/health
Invoke-RestMethod http://localhost:5000/api/v1/health/ready
```

The API liveness route can respond while dependencies are unavailable. Readiness returns HTTP 503 until MongoDB, resolution, delay-risk, and workload services are reachable.

## Troubleshooting

- **MongoDB unavailable:** check `MONGODB_URI` and the local service. Sign-in and saved history need MongoDB.
- **Resolution service unavailable:** confirm the model artifact exists under `ml/artifacts/resolution` and check Python package compatibility.
- **Forecast service unavailable:** confirm XGBoost and the forecasting configuration are installed and present. The health route checks runtime/configuration readiness; a real forecast can still reject unsuitable history.
- **Delay-risk service unavailable:** confirm `.venv-delayrisk` exists with packages from `ml/requirements-delay-risk.txt` and port 8001 is free.
- **Port conflict:** inspect ports 5173, 5000, 8000, and 8001 and update the corresponding local configuration.
