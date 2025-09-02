module.exports = (req, res) => {
  const keys = ['GOOGLE_PROJECT_ID','GOOGLE_SERVICE_EMAIL','GOOGLE_PRIVATE_KEY'];
  const result = {};
  for (const k of keys) result[k] = !!process.env[k];
  res.status(200).json(result);
};
