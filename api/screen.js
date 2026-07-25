// Vercel serverless function: POST /api/screen
// Body: { name: string, country?: string }
// Uses Google's Gemini API with the built-in Google Search grounding tool.
// Holds the API key server-side — never exposed to the browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, country } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Missing 'name' in request body" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: GEMINI_API_KEY not set" });
  }

  const prompt = `You are verifying a company's current operating status and public contact details.

Company name: "${name}"${country ? `\nCountry (from source list, may be imprecise): ${country}` : ""}

Search the web to find this specific company (do not confuse it with similarly-named companies). Determine:
- status: "active" if you find current evidence of operations, "unclear" if you find the company but can't confirm current status, "not_found" if you cannot locate it at all
- website: the official company website URL, or null
- phone: a public phone number, or null
- email: a public contact email, or null
- notes: one short sentence (max 20 words) on anything relevant (e.g. "site under different name", "appears to be a trading arm of X")

Respond with ONLY a raw JSON object, no markdown fences, no prose before or after, in exactly this shape:
{"status":"active|unclear|not_found","website":null,"phone":null,"email":null,"notes":""}`;

  // Model: gemini-2.5-flash is on the free tier as of mid-2026.
  // If Google renames/retires it, swap this string for whatever Flash model
  // currently shows "Free tier" in https://ai.google.dev/gemini-api/docs/pricing
  const model = "gemini-2.5-flash";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Gemini API error: ${errText}` });
    }

    const data = await response.json();
    const candidate = (data.candidates || [])[0];
    const parts = candidate?.content?.parts || [];
    const rawText = parts.map((p) => p.text || "").join("\n").trim();

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({
        error: "Model did not return parseable JSON",
        raw: rawText.slice(0, 500),
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json({
      status: parsed.status || "unclear",
      website: parsed.website || null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      notes: parsed.notes || "",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
