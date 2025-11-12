import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { config } from "dotenv";
import { z } from "zod";

config();

/* ---------- Config ---------- */
const PORT = Number(process.env.PORT || 8080);
const APP_NAME = process.env.APP_NAME || "zkChan Backend";
const LOG_FORMAT = process.env.LOG_FORMAT || "dev";
const JUPITER_BASE = process.env.JUPITER_BASE || "https://quote-api.jup.ag";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);

const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const allowedOrigins = envOrigins.length ? envOrigins : ["https://zk-chan.fun"];

/* ---------- App ---------- */
const app = express();
app.set("trust proxy", true);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(morgan(LOG_FORMAT));
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin(origin, cb){
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"));
  }
}));

/* ---------- Rate limit ---------- */
app.use("/api/", rateLimit({
  windowMs: 60_000, max: 120,
  standardHeaders: true, legacyHeaders: false
}));

/* ---------- Helpers ---------- */
async function fetchJSON(url, init){
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try{
    const r = await fetch(url, { ...init, signal: ac.signal });
    const js = await r.json().catch(()=> ({}));
    if(!r.ok) throw new Error(js?.error || `Fetch failed: ${r.status}`);
    return js;
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Schemas ---------- */
const QuoteBody = z.object({
  inputMint: z.string().min(8),
  outputMint: z.string().min(8),
  amount: z.string().regex(/^\d+$/), // integer in smallest units
  slippageBps: z.number().int().min(1).max(1000).default(50),
  onlyDirectRoutes: z.boolean().optional().default(false)
});

const SwapBody = z.object({
  userPublicKey: z.string().min(32),
  quoteResponse: z.record(z.any()),  // pass-through from /quote
  wrapAndUnwrapSol: z.boolean().optional().default(true),
  useSharedAccounts: z.boolean().optional().default(true),
  dynamicComputeUnitLimit: z.boolean().optional().default(true),
  prioritizationFeeLamports: z.number().int().min(0).optional().default(0)
});

/* ---------- Routes ---------- */
app.get("/", (_req, res) => {
  res.type("text/plain").send(`${APP_NAME} is running`);
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: APP_NAME, time: new Date().toISOString() });
});

/** Token list passthrough (filtered minimal) */
app.get("/api/tokens", async (_req, res) => {
  try{
    const list = await fetchJSON("https://token.jup.ag/all");
    // keep essentials (symbol, name, address, decimals, tags)
    const small = list.map(t => ({
      address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, tags: t.tags || []
    }));
    res.json({ ok: true, tokens: small });
  }catch(err){
    res.status(500).json({ ok:false, error: String(err.message || err) });
  }
});

/** Quote: build Jupiter quote (mainnet) */
app.post("/api/quote", async (req, res) => {
  try{
    const data = QuoteBody.parse(req.body);
    const params = new URLSearchParams({
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      amount: data.amount,
      slippageBps: String(data.slippageBps),
      onlyDirectRoutes: String(Boolean(data.onlyDirectRoutes)),
      // 'exactIn' by default; you can add more query params if needed
    });
    const url = `${JUPITER_BASE}/v6/quote?${params.toString()}`;
    const quote = await fetchJSON(url);
    res.json({ ok:true, quote });
  }catch(err){
    res.status(400).json({ ok:false, error: String(err.message || err) });
  }
});

/** Swap: get serialized tx from Jupiter for client to sign-and-send */
app.post("/api/swap", async (req, res) => {
  try{
    const data = SwapBody.parse(req.body);
    const url = `${JUPITER_BASE}/v6/swap`;
    const body = {
      quoteResponse: data.quoteResponse,
      userPublicKey: data.userPublicKey,
      wrapAndUnwrapSol: data.wrapAndUnwrapSol,
      dynamicComputeUnitLimit: data.dynamicComputeUnitLimit,
      prioritizationFeeLamports: data.prioritizationFeeLamports,
      useSharedAccounts: data.useSharedAccounts
    };
    const js = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });
    // js.swapTransaction is base64, ready for wallet to sign
    res.json({ ok:true, swapTransaction: js.swapTransaction });
  }catch(err){
    res.status(400).json({ ok:false, error: String(err.message || err) });
  }
});

/** Errors */
app.use((err, _req, res, _next) => {
  if (err && /CORS/.test(String(err))) {
    return res.status(403).json({ ok:false, error:String(err.message || err) });
  }
  console.error(err);
  res.status(500).json({ ok:false, error:"Internal server error" });
});

/** Start */
app.listen(PORT, () => {
  console.log(`[${APP_NAME}] listening on :${PORT}`);
  console.log(`CORS: ${allowedOrigins.join(", ")}`);
  console.log(`Jupiter: ${JUPITER_BASE}`);
});
