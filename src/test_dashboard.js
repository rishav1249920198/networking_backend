require('dotenv').config();
const { getAdminDashboard, getStudentDashboard } = require('./controllers/dashboardController');

async function test() {
  const req = {
    user: {
      id: 'a15116e0-edab-4a18-a971-c049a9844887',
      role: 'co-admin',
      centre_id: '02d7449a-696f-4f7d-bd24-484ca3da4bd7'
    }
  };
  const res = {
    json: (data) => console.log('JSON Output:', JSON.stringify(data, null, 2)),
    status: (code) => ({ json: (data) => console.log(`Status ${code}:`, JSON.stringify(data)) })
  };

  console.log('--- ADMIN DASHBOARD ---');
  await getAdminDashboard(req, res);

  console.log('--- STUDENT DASHBOARD ---');
  await getStudentDashboard(req, res);

  process.exit();
}
test();
