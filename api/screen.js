// Vercel serverless function: POST /api/screen
// Body: { name: string, country?: string, force?: boolean }
// Uses OpenAI's Responses API with the built-in web_search tool.
// Results are saved to Supabase so they persist as a permanent asset —
// re-screening the same company reuses the saved result instead of
// spending tokens again, unless force=true is passed.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function getCached(name) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/screened_companies?name_normalized=eq.${encodeURIComponent(
    normalizeName(name)
  )}&select=*&limit=1`;
  const resp = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

async function saveResult(name, country, result) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const url = `${SUPABASE_URL}/rest/v1/screened_companies?on_conflict=name_normalized`;
  await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([
      {
        name,
        country: country || null,
        status: result.status,
        website: result.website,
        phone: result.phone,
        email: result.email,
        notes: result.notes,
        updated_at: new Date().toISOString(),
      },
    ]),
  }).catch(() => {}); // saving is best-effort; never block the response on it
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, country, force } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Missing 'name' in request body" });
  }

  // Reuse a saved result unless the caller explicitly asks to re-screen.
  if (!force) {
    const cached = await getCached(name);
    if (cached) {
      return res.status(200).json({
        status: cached.status,
        website: cached.website,
        phone: cached.phone,
        email: cached.email,
        notes: cached.notes,
        cached: true,
        cachedAt: cached.updated_at,
      });
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: OPENAI_API_KEY not set" });
  }

  const prompt = `You are verifying a company's current operating status and public contact details.

Company name: "${name}"${country ? `\nCountry (from source list, may be imprecise): ${country}` : ""}

Search the web to find this specific company (do not confuse it with similarly-named companies). Search at most 2 times — stop once you have enough to decide. Determine:
- status: "active" if you find current evidence of operations, "unclear" if you find the company but can't confirm current status, "not_found" if you cannot locate it at all
- website: the official company website URL, or null
- phone: a public phone number, or null
- email: a public contact email, or null
- notes: max 8 words, terse fragment only (e.g. "subsidiary of X", "site outdated")

Respond with ONLY a raw JSON object, no markdown fences, no prose before or after, in exactly this shape:
{"status":"active|unclear|not_found","website":null,"phone":null,"email":null,"notes":""}`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        tools: [{ type: "web_search_preview" }],
        max_output_tokens: 1500,
        input: prompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenAI API error: ${errText}` });
    }

    const data = await response.json();

    let rawText = (data.output_text || "").trim();
    if (!rawText && Array.isArray(data.output)) {
      const messageItem = data.output.find((item) => item.type === "message");
      if (messageItem && Array.isArray(messageItem.content)) {
        rawText = messageItem.content
          .filter((c) => c.type === "output_text")
          .map((c) => c.text)
          .join("\n")
          .trim();
      }
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({
        error: "Model did not return parseable JSON",
        raw: rawText.slice(0, 500),
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result = {
      status: parsed.status || "unclear",
      website: parsed.website || null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      notes: parsed.notes || "",
    };

    await saveResult(name, country, result);

    return res.status(200).json({ ...result, cached: false });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
