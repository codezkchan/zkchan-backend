# zkChan Backend

Express API that proxies **Jupiter Aggregator** for quotes and generates a **serialized swap transaction**, which the frontend signs and sends via Phantom.

## Endpoints
- `GET /health` – service health
- `GET /api/tokens` – token list (via token.jup.ag)
- `POST /api/quote` – Jupiter quote proxy
- `POST /api/swap` – Jupiter swap (returns `swapTransaction` base64)

## Run
```bash
cp .env.example .env
# Ensure CORS_ORIGINS has your website origin (e.g., https://zk-chan.fun)
npm i
npm run dev
