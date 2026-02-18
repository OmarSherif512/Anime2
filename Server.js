const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const CONSUMET = "https://api-consumet-org-uz5d.onrender.com";
const PUBLIC_DIR = path.join(__dirname, "public");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ results: [] });

  try {
    const { data } = await axios.get(`${CONSUMET}/anime/hianime/search?query=${encodeURIComponent(q)}`, {
      timeout: 15000,
    });

    const results = (data.results || []).map(r => ({
      slug: r.id,
      name: r.title,
      img: r.image || "",
      type: r.type || "",
      duration: r.duration || "",
      sub: r.sub || "",
      dub: r.dub || "",
      rating: r.rating || "",
    }));

    res.json({ results });
  } catch (err) {
    console.error("[search]", err.message);
    res.status(500).json({ error: "Search failed", message: err.message });
  }
});

app.get("/api/detail", async (req, res) => {
  const slug = (req.query.slug || "").trim();
  if (!slug) return res.status(400).json({ error: "Missing slug" });

  try {
    const { data } = await axios.get(`${CONSUMET}/anime/hianime/info?id=${encodeURIComponent(slug)}`, {
      timeout: 15000,
    });

    const episodes = (data.episodes || []).map(ep => ({
      num: ep.number,
      title: ep.title || `Episode ${ep.number}`,
      epId: ep.id,
    }));

    res.json({
      slug,
      title: data.title,
      poster: data.cover || data.image || "",
      description: data.description || "",
      rating: data.rating || "",
      animeType: data.type || "",
      duration: data.duration || "",
      studio: data.studios?.[0] || "",
      genres: data.genres || [],
      subCount: data.subOrDub === "sub" ? episodes.length : (data.sub || ""),
      dubCount: data.subOrDub === "dub" ? episodes.length : (data.dub || ""),
      episodes,
    });
  } catch (err) {
    console.error("[detail]", err.message);
    res.status(500).json({ error: "Failed to load anime", message: err.message });
  }
});

app.get("/api/sources", async (req, res) => {
  const { epId, category = "sub" } = req.query;
  if (!epId) return res.status(400).json({ error: "epId is required" });

  try {
    const { data } = await axios.get(
      `${CONSUMET}/anime/hianime/watch?episodeId=${encodeURIComponent(epId)}&server=vidstreaming&dub=${category === "dub"}`,
      { timeout: 20000 }
    );

    const source = data.sources?.[0]?.url;
    if (!source) throw new Error("No source URL returned from Consumet");

    const tracks = (data.subtitles || [])
      .filter(t => t.url && t.lang !== "Thumbnails")
      .map(t => ({
        kind: "subtitles",
        label: t.lang,
        lang: t.lang?.toLowerCase().slice(0, 2) || "",
        file: `/proxy?url=${encodeURIComponent(t.url)}`,
      }));

    res.json({
      source: `/proxy?url=${encodeURIComponent(source)}`,
      tracks,
    });
  } catch (err) {
    console.error("[sources]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url");

  try {
    const upstream = await axios.get(target, {
      headers: {
        "User-Agent": UA,
        "Referer": "https://megacloud.blog/",
        "Origin": "https://megacloud.blog",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      responseType: "arraybuffer",
      validateStatus: null,
      maxRedirects: 5,
      timeout: 15000,
    });

    if (upstream.status !== 200) return res.status(upstream.status).send(`Upstream error: ${upstream.status}`);

    const contentType = upstream.headers["content-type"] || "application/octet-stream";
    res.setHeader("Access-Control-Allow-Origin", "*");

    const isM3U8 = target.includes(".m3u8") || contentType.includes("mpegurl");
    if (isM3U8) {
      const base = target.substring(0, target.lastIndexOf("/") + 1);
      let text = Buffer.from(upstream.data).toString("utf8");
      text = text.replace(/^(?!#)(.+)$/gm, line => {
        line = line.trim();
        if (!line) return line;
        const abs = line.startsWith("http") ? line : base + line;
        return `/proxy?url=${encodeURIComponent(abs)}`;
      });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(text);
    }

    const isTS = target.includes(".ts") || contentType.includes("MP2T") || contentType.includes("mp2t");
    res.setHeader("Content-Type", isTS ? "video/MP2T" : contentType);
    res.send(Buffer.from(upstream.data));
  } catch (err) {
    console.error("[proxy]", err.message);
    res.status(500).send(err.message);
  }
});

app.get("/subtitles", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url");

  try {
    const upstream = await axios.get(target, {
      headers: { "User-Agent": UA, "Accept": "*/*" },
      responseType: "arraybuffer",
      timeout: 10000,
      validateStatus: null,
      maxRedirects: 5,
    });

    if (upstream.status !== 200) return res.status(upstream.status).send(`Upstream error: ${upstream.status}`);

    const raw = Buffer.from(upstream.data).toString("utf8");
    const vtt = raw.trimStart().startsWith("WEBVTT") ? raw : srtToVtt(raw);

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(vtt);
  } catch (err) {
    console.error("[subtitles]", err.message);
    res.status(500).send(err.message);
  }
});

function srtToVtt(srt) {
  return (
    "WEBVTT\n\n" +
    srt
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
      .replace(/^\d+\s*\n/gm, "")
      .trim()
  );
}

app.listen(PORT, () => {
  console.log(`\nAniSearch running at http://localhost:${PORT}`);
  console.log(`Serving static files from: ${PUBLIC_DIR}`);
  console.log(`index.html exists: ${fs.existsSync(path.join(PUBLIC_DIR, "index.html"))}\n`);
});
