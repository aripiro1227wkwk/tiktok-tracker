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

  try {
    // 現在追跡中の動画を取得
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_settings` +
      `?select=video_id,video_url,tracking_started_at` +
      `&order=id.desc&limit=1`,
      {
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`
        }
      }
    );

    const settingsData = await settingsResponse.json();

    if (!settingsResponse.ok) {
      return res.status(settingsResponse.status).json({
        error: "TikTok settings could not be retrieved"
      });
    }

    if (!Array.isArray(settingsData) || settingsData.length === 0) {
      return res.status(404).json({
        error: "No tracking video is configured"
      });
    }

    const currentVideo = settingsData[0];

    // Supabaseに保存済みの最新記録だけ取得
    const recordResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshots` +
      `?video_id=eq.${encodeURIComponent(currentVideo.video_id)}` +
      `&select=video_id,video_url,description,snapshot_date,snapshot_hour,views,likes,comments,shares,saves,recorded_at` +
      `&order=recorded_at.desc&limit=1`,
      {
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`
        }
      }
    );

    const recordData = await recordResponse.json();

    if (!recordResponse.ok) {
      return res.status(recordResponse.status).json({
        error: "Latest snapshot could not be retrieved"
      });
    }

    if (!Array.isArray(recordData) || recordData.length === 0) {
      return res.status(200).json({
        success: true,
        has_record: false,
        video_id: currentVideo.video_id,
        video_url: currentVideo.video_url,
        tracking_started_at: currentVideo.tracking_started_at
      });
    }

    return res.status(200).json({
      success: true,
      has_record: true,
      tracking_started_at: currentVideo.tracking_started_at,
      ...recordData[0]
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Latest snapshot fetch failed"
    });
  }
}
