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

  const requestAdminKey = req.headers["x-admin-key"];

  if (!requestAdminKey || requestAdminKey !== adminKey) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const videoUrl = String(
    req.body?.video_url || ""
  ).trim();

  if (!videoUrl) {
    return res.status(400).json({
      error: "TikTok URL is required"
    });
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(videoUrl);
  } catch {
    return res.status(400).json({
      error: "Valid TikTok video URL is required"
    });
  }

  const hostname =
    parsedUrl.hostname.toLowerCase();

  if (
    hostname !== "tiktok.com" &&
    hostname !== "www.tiktok.com"
  ) {
    return res.status(400).json({
      error: "TikTok URL is required"
    });
  }

  const match =
    parsedUrl.pathname.match(/\/video\/(\d+)/);

  if (!match) {
    return res.status(400).json({
      error: "Valid TikTok video URL is required"
    });
  }

  const videoId = match[1];

  try {

    // 現在設定されている動画を確認
    const currentResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_settings` +
      `?select=video_id,video_url,tracking_started_at` +
      `&order=id.desc&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`
        }
      }
    );

    const currentData =
      await currentResponse.json();

    if (!currentResponse.ok) {
      return res.status(
        currentResponse.status
      ).json({
        error:
          "Current TikTok settings could not be retrieved",
        details: currentData
      });
    }

    // 同じ動画なら変更しない
    if (
      Array.isArray(currentData) &&
      currentData.length > 0 &&
      String(currentData[0].video_id) ===
        String(videoId)
    ) {
      return res.status(200).json({
        success: true,
        changed: false,
        message:
          "This video is already being tracked",
        video_id: videoId,
        video_url: currentData[0].video_url,
        tracking_started_at:
          currentData[0].tracking_started_at
      });
    }

    // 新しい動画なら設定を追加
    const response = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_settings`,
      {
        method: "POST",
        headers: {
          apikey: supabaseSecretKey,
          Authorization:
            `Bearer ${supabaseSecretKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          video_url: videoUrl,
          video_id: videoId,
          tracking_started_at:
            new Date().toISOString()
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          "TikTok settings could not be saved",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      changed: true,
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
