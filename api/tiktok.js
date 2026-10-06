export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const apiKey = process.env.QUANTICDATA_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "API key is not configured"
    });
  }

  const videoUrl =
    "https://www.tiktok.com/@jr_official_tiktok/video/7693521058934033670";

  try {
    const response = await fetch(
      "https://api.quanticdata.io/v1/scraper/collectors/tiktok_video/run",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          videos: [videoUrl],
          max_results: 1
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("QuanticData error:", data);

      return res.status(response.status).json({
        error: "TikTok data could not be retrieved"
      });
    }

    // QuanticData本番APIは payload.results に結果が入る
    const results = data?.payload?.results || data?.results || [];

    if (results.length === 0) {
      return res.status(404).json({
        error: "TikTok video data was not found"
      });
    }

    const video = results[0];

    // ブラウザには必要な情報だけ返す
    return res.status(200).json({
      video_id: video.video_id,
      url: video.url,
      description: video.description,
      created_at: video.created_at,

      views: video.views,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      saves: video.saves,

      fetched_at: new Date().toISOString()
    });

  } catch (error) {
    console.error("TikTok API error:", error);

    return res.status(500).json({
      error: "Failed to retrieve TikTok data"
    });
  }
}
