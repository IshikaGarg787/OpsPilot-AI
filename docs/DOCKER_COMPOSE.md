# Run the full OpsPilot AI stack with Docker Compose

This setup runs the React frontend, Express API, resolution/workload model, delay-risk model, and MongoDB. Open the app through the single frontend address at `http://localhost:8080`; Nginx serves the frontend and forwards `/api/` requests internally to Express.

## Requirements

- Docker Desktop installed and running (with the WSL 2 backend on Windows).
- At least 8 GB of available memory is recommended for building the Python model images.

## First run (Windows PowerShell)

From the repository root:

```powershell
Copy-Item .env.docker.example .env
$sessionSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$modelToken = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
(Get-Content .env) -replace '^SESSION_SECRET=.*$', "SESSION_SECRET=$sessionSecret" -replace '^MODEL_API_TOKEN=.*$', "MODEL_API_TOKEN=$modelToken" | Set-Content .env
docker compose up --build -d
docker compose ps
```

The first build downloads Node.js/Python dependencies and can take several minutes. When the API reports healthy, visit `http://localhost:8080`. To verify the services, open `http://localhost:8080/api/v1/health/ready`; it should report MongoDB and all model services available.

By default, Compose uses its own MongoDB container and persistent `opspilot_mongo_data` volume. This keeps data across restarts on this PC, but does not include accounts or tickets from another environment and does not sync with other devices. To share an existing database, set `MONGODB_URI` in `.env` to the same private MongoDB connection string used by that environment. Keep this value private and use the same URI in each device's local `.env`.

## Useful commands

```powershell
docker compose logs -f
docker compose logs -f api
docker compose down
docker compose up --build -d
```

`docker compose down` keeps the MongoDB data volume. To permanently delete the local database as well, use `docker compose down --volumes` (this deletes its saved data).

The API and model services are reachable only inside the Compose network. MongoDB is bound to `127.0.0.1:27017` for optional local tools; the web app is available at port 8080. Set `CLIENT_ORIGIN` in `compose.yaml` if you change the browser origin/port. Keep `.env` private and never commit its values.

## Admin account

Public signup creates customer accounts only. Provision the workspace Admin through the existing protected `admin:provision` command after the services are running; follow [`database-architecture.md`](database-architecture.md) for the required environment values and procedure.
