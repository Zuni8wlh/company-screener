// Vercel serverless function: POST /api/import
// Body: { rows: [{ name, country?, status?, website?, phone?, email?, notes? }, ...] }
// Bulk-saves previously-exported results into Supabase without calling any
// AI provider — used to backfill history from old CSV exports, at no token cost.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Server misconfigured: Supabase env vars not set" });
  }

  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "Missing or empty 'rows' array" });
  }

  const cleaned = rows
    .filter((r) => r && r.name && r.name.toString().trim().length > 0)
    .map((r) => ({
      name: r.name.toString().trim(),
      name_normalized: normalizeName(r.name.toString()),
      country: r.country || null,
      status: r.status || "unclear",
      website: r.website || null,
      phone: r.phone || null,
      email: r.email || null,
      notes: r.notes || null,
      updated_at: new Date().toISOString(),
    }));

  if (!cleaned.length) {
    return res.status(400).json({ error: "No valid rows (each needs at least a name)" });
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/screened_companies?on_conflict=name_normalized`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(cleaned),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Supabase error: ${errText}` });
    }

    return res.status(200).json({ imported: cleaned.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
