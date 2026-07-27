// Vercel serverless function: POST /api/import
// Body: { rows: [{ name, country?, status?, website?, phone?, email?, notes? }, ...], folder?: string }
// Bulk-saves previously-exported results into Supabase without calling any
// AI provider — used to backfill history from old CSV/XLSX exports, at no
// token cost. Tags all imported rows under the given folder (merging with
// any folders that company is already saved under).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_FOLDER = "Uncategorized";

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function getExistingFoldersMap(names) {
  if (!names.length) return {};
  const normalized = names.map(normalizeName);
  const url = `${SUPABASE_URL}/rest/v1/screened_companies?name_normalized=in.(${normalized
    .map((n) => `"${n.replace(/"/g, '\\"')}"`)
    .join(",")})&select=name_normalized,folders`;
  const resp = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) return {};
  const rows = await resp.json();
  const map = {};
  rows.forEach((r) => (map[r.name_normalized] = r.folders || []));
  return map;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Server misconfigured: Supabase env vars not set" });
  }

  const { rows, folder } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "Missing or empty 'rows' array" });
  }

  const targetFolder = folder || DEFAULT_FOLDER;
  const validRows = rows.filter((r) => r && r.name && r.name.toString().trim().length > 0);
  if (!validRows.length) {
    return res.status(400).json({ error: "No valid rows (each needs at least a name)" });
  }

  const existingFoldersMap = await getExistingFoldersMap(validRows.map((r) => r.name.toString()));

  const cleaned = validRows.map((r) => {
    const norm = normalizeName(r.name.toString());
    const existingFolders = existingFoldersMap[norm] || [];
    const folders = Array.from(new Set([...existingFolders, targetFolder]));
    return {
      name: r.name.toString().trim(),
      country: r.country || null,
      status: r.status || "unclear",
      website: r.website || null,
      phone: r.phone || null,
      email: r.email || null,
      notes: r.notes || null,
      folders,
      updated_at: new Date().toISOString(),
    };
  });

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

    return res.status(200).json({ imported: cleaned.length, folder: targetFolder });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
