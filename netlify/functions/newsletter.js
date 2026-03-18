import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// Extracts plain text from HTML for auto-generating title/excerpt
function stripTags(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Pulls the h1 text from the newsletter HTML
function extractTitle(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? stripTags(match[1]) : "SSKIN CITY Newsletter";
}

// Pulls the first paragraph text for the blog card preview
function extractExcerpt(html) {
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!match) return "";
  const text = stripTags(match[1]);
  return text.length > 180 ? text.slice(0, 180) + "…" : text;
}

// Removes script tags for basic security
function sanitize(html) {
  return html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ""
  );
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const store = getStore({ name: "newsletters", consistency: "strong" });

  // ── GET: website fetches all newsletters on page load ──
  if (event.httpMethod === "GET") {
    try {
      const { blobs } = await store.list();
      if (!blobs.length) {
        return { statusCode: 200, headers: CORS, body: "[]" };
      }
      const all = await Promise.all(
        blobs.map((b) => store.get(b.key, { type: "json" }))
      );
      const sorted = all
        .filter(Boolean)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify(sorted),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  // ── POST: Activepieces sends a new newsletter ──
  if (event.httpMethod === "POST") {
    const secret = event.headers["x-api-key"];
    if (!secret || secret !== process.env.NEWSLETTER_SECRET) {
      return {
        statusCode: 401,
        headers: CORS,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    let data;
    try {
      data = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "Invalid JSON" }),
      };
    }

    if (!data.html) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "html field is required" }),
      };
    }

    const safeHtml = sanitize(data.html);

    // Auto-extract title and excerpt from the HTML if not sent by Activepieces
    const title = data.title || extractTitle(safeHtml);
    const excerpt = data.excerpt || extractExcerpt(safeHtml);

    const id = `nl_${Date.now()}`;

    try {
      await store.setJSON(id, {
        id,
        title,
        excerpt,
        html: safeHtml,
        date: data.date || new Date().toISOString(),
        category: data.category || "Newsletter",
        readTime: data.readTime || "5 min read",
        issue: data.issue || "",
      });

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ success: true, id, title }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: CORS,
    body: JSON.stringify({ error: "Method not allowed" }),
  };
};
