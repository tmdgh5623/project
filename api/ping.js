export default async function handler(req, res) {
  try {
    res.status(200).json({
      ok: true,
      serviceEmail: process.env.GOOGLE_SERVICE_EMAIL || null,
      hasKey: !!process.env.GOOGLE_PRIVATE_KEY,
      project: process.env.GOOGLE_PROJECT_ID || null
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e) });
  }
}
