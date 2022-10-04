const process = require('process');
const cp = require('child_process');
const path = require('path');

test('test runs', () => {
  const ip = path.join(__dirname, "dist", 'index.js');
  const result = cp.execSync(`node ${ip}`, {filePath: "test"}).toString();
  console.log(result);
})
