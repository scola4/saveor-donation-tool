module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });

  // Parse body — Vercel may pass it as string or object
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: "Invalid JSON body." });
    }
  }
  if (!body) return res.status(400).json({ error: "Empty request body." });

  const { zip, items, categories } = body;
  if (!zip || !items) return res.status(400).json({ error: "Missing zip or items." });

  const prompt = `You are a local charity finder. A user near zip code ${zip} wants to donate: ${items} (categories: ${categories || "general"}).

Use web search to find 5-7 real, currently operating donation centers near zip code ${zip}. Include national chains (Goodwill, Habitat for Humanity ReStore, Salvation Army, Vietnam Veterans of America, St. Vincent de Paul) and local/niche orgs relevant to the items.

Verify each website URL is real and active.

Respond with ONLY a JSON array. No text before or after. Start with [ and end with ]:
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
        model: "claude-haiku-4-5-20251001",
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
    try { data = JSON.parse(rawText); }
    catch (e) { return res.status(500).json({ error: "Could not parse Anthropic response", raw: rawText.slice(0, 200) }); }

    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");

    if (!text) {
      return res.status(500).json({
        error: "No text in response",
        stopReason: data.stop_reason,
        contentTypes: (data.content || []).map(b => b.type)
      });
    }

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
      const sanitized = jsonStr
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"');
      try { parsed = JSON.parse(sanitized); }
      catch (e2) { return res.status(500).json({ error: "JSON parse failed: " + e2.message, raw: jsonStr.slice(0, 400) }); }
    }

    return res.status(200).json({ result: parsed });

  } catch (err) {
    return res.status(500).json({ error: "Exception: " + err.message });
  }
};
