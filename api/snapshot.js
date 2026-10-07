export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const now = new Date();

  // 日本時間
  const japanHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      hourCycle: "h23"
    }).format(now)
  );

  // 3時間ごとの記録
  const snapshotHours = [0, 3, 6, 9, 12, 15, 18, 21];

  if (!snapshotHours.includes(japanHour)) {
    return res.status(200).json({
      success: false,
      saved: false,
      message: "Not a 3-hour snapshot window",
      japan_hour: japanHour
    });
  }

  const quanticApiKey = process.env.QUANTICDATA_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!quanticApiKey || !supabaseUrl || !supabaseSecretKey) {
    return res.status(500).json({
      error: "Environment variables are not configured"
    });
  }

  try {
    // ----------------------------------------
    // ① 現在追跡中の動画をSupabaseから取得
    // ----------------------------------------

    const settingsResponse = await fetch(
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

    const settingsData = await settingsResponse.json();

    if (!settingsResponse.ok) {
      return res.status(settingsResponse.status).json({
        error: "TikTok settings could not be retrieved",
        details: settingsData
      });
    }

    if (!Array.isArray(settingsData) || settingsData.length === 0) {
      return res.status(404).json({
        error: "No tracking video is configured"
      });
    }

    const currentVideo = settingsData[0];

    const videoId = currentVideo.video_id;
    const videoUrl = currentVideo.video_url;

    if (!videoId || !videoUrl) {
      return res.status(500).json({
        error: "Tracking video settings are incomplete"
      });
    }

    // ----------------------------------------
    // ② 日本時間の日付
    // ----------------------------------------

    const snapshotDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);

    // ----------------------------------------
    // ③ 同じ動画・日付・時間の記録があるか確認
    // QuanticDataを呼ぶ前に確認する
    // ----------------------------------------

    const checkUrl =
      `${supabaseUrl}/rest/v1/tiktok_snapshots` +
      `?video_id=eq.${encodeURIComponent(videoId)}` +
      `&snapshot_date=eq.${snapshotDate}` +
      `&snapshot_hour=eq.${japanHour}` +
      `&select=id`;

    const checkResponse = await fetch(checkUrl, {
      method: "GET",
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`
      }
    });

    const existingData = await checkResponse.json();

    if (!checkResponse.ok) {
      return res.status(checkResponse.status).json({
        error: "Supabase duplicate check failed",
        details: existingData
      });
    }

    // すでに記録済みならQuanticDataを使わず終了
    if (existingData.length > 0) {
      return res.status(200).json({
        success: true,
        saved: false,
        message: "Snapshot already exists",
        video_id: videoId,
        snapshot_date: snapshotDate,
        snapshot_hour: japanHour
      });
    }

    // ----------------------------------------
    // ④ 未記録の場合だけQuanticDataを呼ぶ
    // ----------------------------------------

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

if (!Array.isArray(results) || results.length === 0) {
  console.error("QuanticData response:", JSON.stringify(tiktokData));

  return res.status(404).json({
    error: "TikTok video data was not found",
    debug: {
      top_level_keys:
        tiktokData && typeof tiktokData === "object"
          ? Object.keys(tiktokData)
          : [],
      payload_keys:
        tiktokData?.payload &&
        typeof tiktokData.payload === "object"
          ? Object.keys(tiktokData.payload)
          : [],
      status: tiktokData?.status || null,
      message: tiktokData?.message || null
    }
  });
}

    const video = results[0];

    // ----------------------------------------
    // ⑤ Supabaseへ保存
    // ----------------------------------------

    const saveResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshots`,
      {
        method: "POST",
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          video_id: video.video_id || videoId,
          video_url: video.url || videoUrl,
          description: video.description || "",
          snapshot_date: snapshotDate,
          snapshot_hour: japanHour,
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
      saved: true,
      video_id: videoId,
      snapshot_date: snapshotDate,
      snapshot_hour: japanHour,
      data: savedData
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Snapshot failed"
    });
  }
}
