
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const now = new Date();

  const japanParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const getPart = (type) =>
    japanParts.find(part => part.type === type)?.value;

  const japanHour = Number(getPart("hour"));
  const japanMinute = Number(getPart("minute"));

  const snapshotDate =
    `${getPart("year")}-${getPart("month")}-${getPart("day")}`;

  const snapshotHours = [0, 3, 6, 9, 12, 15, 18, 21];
  const retryMinutes = [0, 5, 10];

  if (
    !snapshotHours.includes(japanHour) ||
    !retryMinutes.includes(japanMinute)
  ) {
    return res.status(200).json({
      success: false,
      saved: false,
      message: "Outside snapshot schedule",
      japan_hour: japanHour,
      japan_minute: japanMinute
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

  const supabaseHeaders = {
    apikey: supabaseSecretKey,
    Authorization: `Bearer ${supabaseSecretKey}`
  };

  const attempt =
    japanMinute === 0 ? 1 :
    japanMinute === 5 ? 2 : 3;

  let videoId = null;
  let videoUrl = null;

  // 最終再試行が失敗した場合だけ失敗記録を保存
  async function saveFailure(errorMessage) {
    if (japanMinute !== 10 || !videoId) {
      return { attempted: false };
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshot_failures` +
      `?on_conflict=video_id,snapshot_date,snapshot_hour`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal"
        },
        body: JSON.stringify({
          video_id: videoId,
          snapshot_date: snapshotDate,
          snapshot_hour: japanHour,
          error_message: errorMessage
        })
      }
    );

    if (!response.ok) {
      const details = await response.text();

      console.error(
        "Failure record save failed:",
        response.status,
        details
      );

      return {
        attempted: true,
        saved: false,
        status: response.status
      };
    }

    return {
      attempted: true,
      saved: true
    };
  }

  try {
    // ① 現在追跡中の動画を取得
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_settings` +
      `?select=video_id,video_url,tracking_started_at` +
      `&order=id.desc&limit=1`,
      {
        headers: supabaseHeaders
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

    videoId = settingsData[0].video_id;
    videoUrl = settingsData[0].video_url;

    if (!videoId || !videoUrl) {
      return res.status(500).json({
        error: "Tracking video settings are incomplete"
      });
    }

    // ② 同じ時間枠に成功記録があるか確認
    const checkResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshots` +
      `?video_id=eq.${encodeURIComponent(videoId)}` +
      `&snapshot_date=eq.${snapshotDate}` +
      `&snapshot_hour=eq.${japanHour}` +
      `&select=id&limit=1`,
      {
        headers: supabaseHeaders
      }
    );

    const existingData = await checkResponse.json();

    if (!checkResponse.ok) {
      return res.status(checkResponse.status).json({
        error: "Supabase duplicate check failed",
        details: existingData
      });
    }

    if (existingData.length > 0) {
      return res.status(200).json({
        success: true,
        saved: false,
        message: "Snapshot already exists",
        snapshot_date: snapshotDate,
        snapshot_hour: japanHour,
        attempt
      });
    }

    // ③ QuanticDataで取得
    let tiktokResponse;

    try {
      tiktokResponse = await fetch(
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
    } catch (error) {
      console.error("QuanticData connection failed:", error);

      const failure = await saveFailure(
        "自動取得失敗（通信エラー）"
      );

      return res.status(502).json({
        error: "QuanticData connection failed",
        attempt,
        failure
      });
    }

    let tiktokData;

    try {
      tiktokData = await tiktokResponse.json();
    } catch (error) {
      console.error("QuanticData JSON error:", error);

      const failure = await saveFailure(
        "自動取得失敗（応答エラー）"
      );

      return res.status(502).json({
        error: "QuanticData response could not be parsed",
        attempt,
        failure
      });
    }

    if (!tiktokResponse.ok) {
      console.error(
        "QuanticData request failed:",
        tiktokResponse.status
      );

      const failure = await saveFailure(
        "自動取得失敗（QuanticData HTTP " +
        tiktokResponse.status + "）"
      );

      return res.status(tiktokResponse.status).json({
        error: "TikTok data could not be retrieved",
        failed_at: "QuanticData",
        upstream_status: tiktokResponse.status,
        attempt,
        failure
      });
    }

    const results =
      tiktokData?.payload?.results ||
      tiktokData?.results ||
      [];

    if (!Array.isArray(results) || results.length === 0) {
      const failure = await saveFailure(
        "自動取得失敗（データなし）"
      );

      return res.status(404).json({
        error: "TikTok video data was not found",
        attempt,
        failure
      });
    }

    const video = results[0];

    // ④ 成功記録を保存
    const saveResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshots` +
      `?on_conflict=video_id,snapshot_date,snapshot_hour`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify({
          video_id: videoId,
          video_url: video.url || videoUrl,
          description: video.description || "",
          snapshot_date: snapshotDate,
          snapshot_hour: japanHour,
          views: video.views ?? 0,
          likes: video.likes ?? 0,
          comments: video.comments ?? 0,
          shares: video.shares ?? 0,
          saves: video.saves ?? 0
        })
      }
    );

    if (!saveResponse.ok) {
      const details = await saveResponse.text();

      console.error(
        "Supabase save failed:",
        saveResponse.status,
        details
      );

      return res.status(saveResponse.status).json({
        error: "Supabase save failed",
        failed_at: "Supabase",
        upstream_status: saveResponse.status,
        attempt
      });
    }

    const savedData = await saveResponse.json();

    // ⑤ 成功した時間枠に失敗記録が残っていれば削除
    const deleteResponse = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshot_failures` +
      `?video_id=eq.${encodeURIComponent(videoId)}` +
      `&snapshot_date=eq.${snapshotDate}` +
      `&snapshot_hour=eq.${japanHour}`,
      {
        method: "DELETE",
        headers: supabaseHeaders
      }
    );

    if (!deleteResponse.ok) {
      console.error(
        "Old failure record cleanup failed:",
        deleteResponse.status
      );
    }

    return res.status(200).json({
      success: true,
      saved: savedData.length > 0,
      video_id: videoId,
      snapshot_date: snapshotDate,
      snapshot_hour: japanHour,
      attempt,
      message: "Snapshot completed"
    });

  } catch (error) {
    console.error("Snapshot failed:", error);

    return res.status(500).json({
      error: "Snapshot failed",
      attempt
    });
  }
}
