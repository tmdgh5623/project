export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://script.google.com/macros/s/AKfycbw12xR7tz1fq1iQNbY-WIZUQ4C5wMFOE2vLr70ydsKNgdOx17t2iq3dnok0sjMgpVr_Ig/exec"
    );
    if (!response.ok) {
      throw new Error(`Google Apps Script 오류: ${response.status}`);
    }
    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (error) {
    console.error("프록시 오류:", error);
    res.status(500).json({ error: "프록시 서버 오류" });
  }
}
