# Free demo deployment: Vercel + Render

This deployment serves the React app from Vercel. Render runs the Express API and the two FastAPI model services. MongoDB Atlas stores application data. The browser uses the Vercel site as its only URL; Vercel forwards `/api/*` requests to Render.

This is a free demo configuration, not a production setup. Render Free web services are public, sleep after 15 minutes without traffic, and can take about a minute to wake. The model prediction routes require a shared secret, but their health and metadata routes remain public. Free compute may also be too small for some model builds or inference workloads.

## 1. Create the Vercel project

Import `IshikaGarg787/OpsPilot-AI` into Vercel and set:

- Root Directory: `client`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment variable: `VITE_API_BASE_URL=/api/v1`

Deploy once to get the production Vercel URL. The `client/vercel.json` file serves React Router paths and forwards `/api/*` to `https://opspilot-aigarg-api.onrender.com/api/*`. If Render assigns a different API URL, update that destination and redeploy the client.

## 2. Create the MongoDB Atlas database

Create an Atlas Free cluster, a database user, and a database connection string. In Atlas Network Access, allow the Render service's outbound IP range for the Singapore region. Keep the URI private; it contains a database password.

## 3. Create the Render services from the Blueprint

In Render, create a Blueprint from the same GitHub repository and select `render.yaml`. The Blueprint defines three Free web services in Singapore:

- `opspilot-aigarg-api` — Express API
- `opspilot-aigarg-resolution` — resolution and workload FastAPI service
- `opspilot-aigarg-delayrisk` — delay-risk FastAPI service

When prompted, provide:

- `CLIENT_ORIGIN`: the exact production Vercel URL, including `https://`
- `MONGODB_URI`: the Atlas connection string

Render generates `SESSION_SECRET` and a shared `MODEL_API_TOKEN`. The token is attached to the API and both model services through an environment group. The Express API sends it with prediction requests; the Python services reject unauthenticated prediction requests.

All services are web services because Render Free does not offer private services. Prediction endpoints are protected by the shared token, but the model services still have public hostnames. Do not share those URLs as user-facing app links.

## 4. Confirm the Vercel proxy and production origin

The Render API URL in `client/vercel.json` is expected to be `https://opspilot-aigarg-api.onrender.com`. If the actual URL differs, update the rewrite destination and redeploy Vercel.

In the Render API environment, `CLIENT_ORIGIN` must exactly match the Vercel production URL. The client calls the relative `/api/v1` path through Vercel, keeping the session cookie same-origin in the browser.

## 5. Check the deployment

Open the Vercel URL. The API liveness endpoint is `https://opspilot-aigarg-api.onrender.com/api/v1/health`. The two model health endpoints are `/health`, and the resolution service's forecast health endpoint is `/forecast/health` on its Render URL.

After a service has been idle for 15 minutes, the first request may take about a minute while it wakes. Retry a prediction if the service was asleep. Render's free limits include possible restarts, ephemeral service filesystems, and shared monthly usage limits. Atlas Free clusters are limited development databases.

## 6. Provision the workspace Admin

Public signup cannot create an Admin. Follow the one-time owner provisioning procedure in `database-architecture.md`. A Render Free service does not provide a dashboard shell, so run the documented command locally with the production `MONGODB_URI` and temporary provisioning values set only in your local process environment. Remove the temporary owner password and confirmation values after successful provisioning.

Never commit `.env` files, database URIs, session secrets, model tokens, or the temporary Admin password.
