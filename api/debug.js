export default function handler(req, res) {
  const keys = ['GOOGLE_PROJECT_ID','GOOGLE_SERVICE_EMAIL','GOOGLE_PRIVATE_KEY'];
  res.status(200).json(
    Object.fromEntries(keys.map(k => [k, process.env[k] ? 'set' : 'missing']))
  );
}
