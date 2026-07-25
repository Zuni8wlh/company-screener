// Vercel serverless function: POST /api/screen
// Body: { name: string, country?: string }
// Uses OpenAI's Responses API with the built-in web_search tool.
// Holds the API key server-side — never exposed to the browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, country } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Missing 'name' in request body" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: OPENAI_API_KEY not set" });
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

    // output_text is a convenience field; fall back to scanning output items
    // in case it's empty (can happen when the search tool consumes the turn).
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
