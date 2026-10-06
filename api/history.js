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
    const response = await fetch(
      `${supabaseUrl}/rest/v1/tiktok_snapshots?select=video_id,video_url,description,snapshot_date,views,likes,comments,shares,saves,recorded_at&order=snapshot_date.desc,recorded_at.desc`,
      {
        method: "GET",
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Supabase read failed",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data: data
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "History fetch failed"
    });
  }
}
