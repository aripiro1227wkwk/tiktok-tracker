export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  const adminKey = process.env.ADMIN_KEY;

  if (!supabaseUrl || !supabaseSecretKey || !adminKey) {
    return res.status(500).json({
      error: "Environment variables are not configured"
    });
  }

  // 管理キー確認
  const requestAdminKey = req.headers["x-admin-key"];

  if (!requestAdminKey || requestAdminKey !== adminKey) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const videoUrl = String(req.body?.video_url || "").trim();

  if (!videoUrl) {
    return res.status(400).json({
      error: "TikTok URL is required"
    });
  }

  // TikTok URLからvideo IDを取り出す
  const match = videoUrl.match(/\/video\/(\d+)/);

  if (!match) {
    return res.status(400).json({
      error: "Valid TikTok video URL is required"
    });
  }

  const videoId = match[1];

  try {
    // 新しい設定を追加
    const response = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_settings`,
      {
        method: "POST",
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          video_url: videoUrl,
          video_id: videoId,
          tracking_started_at: new Date().toISOString()
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "TikTok settings could not be saved",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tracking video updated",
      video_id: videoId,
      video_url: videoUrl
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Settings update failed"
    });
  }
}
