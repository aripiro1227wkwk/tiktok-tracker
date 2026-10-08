
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return res.status(500).json({
      error: "Supabase environment variables are not configured"
    });
  }

  const headers = {
    apikey: supabaseSecretKey,
    Authorization: `Bearer ${supabaseSecretKey}`
  };

  try {
    // 現在追跡中の動画
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_settings` +
      `?select=video_id,video_url,tracking_started_at` +
      `&order=id.desc&limit=1`,
      { headers }
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
    const videoId = encodeURIComponent(currentVideo.video_id);

    // 成功した定点記録
    const recordsResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshots` +
      `?video_id=eq.${videoId}` +
      `&select=video_id,video_url,description,snapshot_date,snapshot_hour,views,likes,comments,shares,saves,recorded_at` +
      `&order=recorded_at.desc`,
      { headers }
    );

    if (!recordsResponse.ok) {
      return res.status(recordsResponse.status).json({
        error: "Supabase records read failed",
        details: await recordsResponse.text()
      });
    }

    const records = await recordsResponse.json();

    // 取得失敗した時間枠
    const failuresResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshot_failures` +
      `?video_id=eq.${videoId}` +
      `&select=video_id,snapshot_date,snapshot_hour,error_message,created_at` +
      `&order=snapshot_date.desc,snapshot_hour.desc`,
      { headers }
    );

    if (!failuresResponse.ok) {
      return res.status(failuresResponse.status).json({
        error: "Supabase failures read failed",
        details: await failuresResponse.text()
      });
    }

    const failures = await failuresResponse.json();

    // 成功記録が存在する時間枠は成功を優先
    const successfulSlots = new Set(
      records.map(record =>
        `${record.snapshot_date}_${record.snapshot_hour}`
      )
    );

    const validFailures = failures.filter(failure =>
      !successfulSlots.has(
        `${failure.snapshot_date}_${failure.snapshot_hour}`
      )
    );

    return res.status(200).json({
      success: true,

      current_video: {
        video_id: currentVideo.video_id,
        video_url: currentVideo.video_url,
        tracking_started_at: currentVideo.tracking_started_at
      },

      count: records.length,
      data: records,

      failure_count: validFailures.length,
      failures: validFailures
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Records fetch failed"
    });
  }
}
