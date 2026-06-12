export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });
  }

  const { zip, items, categories } = req.body || {};
  if (!zip || !items) {
    return res.status(400).json({ error: "Missing zip or items." });
  }

  const prompt = `You are a verified local charity finder. A user near zip code ${zip} wants to donate: ${items} (categories: ${categories || "general"}).

Use web search to find 5-7 real, currently operating donation centers near zip code ${zip}. Include a mix of:
- National orgs with local branches (Goodwill, Habitat for Humanity ReStore, Salvation Army, Vietnam Veterans of America, St. Vincent de Paul)
- Local and niche orgs (community thrift stores, women's shelters, domestic violence orgs, faith-based thrift stores, local food banks)
- Specialty orgs when relevant (Dress for Success for clothing, Books for America for books, computer recycling nonprofits for electronics, Furniture Bank for furniture)

CRITICAL: Search to verify each website URL is real and currently active. Use the national site if no local branch URL exists.

Respond with ONLY a JSON array — no text before or after, no markdown. Start with [ and end with ]:
[{"name":"Full name","type":"2-4 word type","address":"Full street address","distanceMiles":1.4,"accepts":["furniture","electronics","clothing","kitchenware","books","art","sports","accessories","tools","baby","other"],"pickup":true,"hours":"Mon-Sat 9am-5pm","phone":"(555) 555-5555","website":"https://verified-url.org"}]`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }]
      })
    });

    const rawText = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Anthropic API error " + response.status,
        detail: rawText.slice(0, 300)
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({ error: "Could not parse Anthropic response", raw: rawText.slice(0, 200) });
    }

    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");

    if (!text) {
      return res.status(500).json({
        error: "No text in Anthropic response",
        stopReason: data.stop_reason,
        contentTypes: (data.content || []).map(b => b.type)
      });
    }

    // Robustly extract JSON array
    let clean = text
      .replace(/^```json\s*/im, "")
      .replace(/^```\s*/im, "")
      .replace(/```\s*$/im, "")
      .trim();

    const start = clean.indexOf("[");
    const end = clean.lastIndexOf("]");

    if (start === -1 || end === -1 || end <= start) {
      return res.status(500).json({ error: "No JSON array in response", raw: text.slice(0, 400) });
    }

    const jsonStr = clean.slice(start, end + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      // Sanitize common AI response issues
      const sanitized = jsonStr
        .replace(/,\s*([}\]])/g, "$1")       // trailing commas
        .replace(/[\u2018\u2019]/g, "'")       // smart single quotes
        .replace(/[\u201C\u201D]/g, '"');      // smart double quotes
      try {
        parsed = JSON.parse(sanitized);
      } catch (e2) {
        return res.status(500).json({ error: "JSON parse failed: " + e2.message, raw: jsonStr.slice(0, 400) });
      }
    }

    return res.status(200).json({ result: parsed });

  } catch (err) {
    return res.status(500).json({ error: "Exception: " + err.message });
  }
}
