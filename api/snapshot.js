export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const quanticApiKey = process.env.QUANTICDATA_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!quanticApiKey || !supabaseUrl || !supabaseSecretKey) {
  return res.status(500).json({
    error: "Environment variables are not configured",
    quanticApiKey: !!quanticApiKey,
    supabaseUrl: !!supabaseUrl,
    supabaseSecretKey: !!supabaseSecretKey
  });
}

  const videoUrl =
    "https://www.tiktok.com/@jr_official_tiktok/video/7693521058934033670";

  try {
    // TikTokの最新データを取得
    const tiktokResponse = await fetch(
      "https://api.quanticdata.io/v1/scraper/collectors/tiktok_video/run",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${quanticApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          videos: [videoUrl],
          max_results: 1
        })
      }
    );

    const tiktokData = await tiktokResponse.json();

    if (!tiktokResponse.ok) {
      return res.status(tiktokResponse.status).json({
        error: "TikTok data could not be retrieved"
      });
    }

    const results =
      tiktokData?.payload?.results ||
      tiktokData?.results ||
      [];

    if (results.length === 0) {
      return res.status(404).json({
        error: "TikTok video data was not found"
      });
    }

    const video = results[0];

    // 日本時間で今日の日付を作る
    const snapshotDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    // Supabaseへ保存
    const saveResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshots?on_conflict=video_id,snapshot_date`,
      {
        method: "POST",
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify({
          video_id: video.video_id,
          video_url: video.url,
          description: video.description || "",
          snapshot_date: snapshotDate,
          views: video.views || 0,
          likes: video.likes || 0,
          comments: video.comments || 0,
          shares: video.shares || 0,
          saves: video.saves || 0
        })
      }
    );

    const savedData = await saveResponse.json();

    if (!saveResponse.ok) {
      return res.status(saveResponse.status).json({
        error: "Supabase save failed",
        details: savedData
      });
    }

    return res.status(200).json({
      success: true,
      snapshot_date: snapshotDate,
      data: savedData
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Snapshot failed"
    });
  }
}
