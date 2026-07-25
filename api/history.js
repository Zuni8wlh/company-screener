// Vercel serverless function: GET /api/history?q=<optional search text>
// Returns saved company screening results from Supabase, newest first.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Server misconfigured: Supabase env vars not set" });
  }

  const q = (req.query.q || "").trim();
  let url = `${SUPABASE_URL}/rest/v1/screened_companies?select=*&order=updated_at.desc&limit=1000`;
  if (q) {
    url += `&name=ilike.*${encodeURIComponent(q)}*`;
  }

  try {
    const resp = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Supabase error: ${errText}` });
    }
    const rows = await resp.json();
    return res.status(200).json({ rows });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
