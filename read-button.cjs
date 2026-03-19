const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'node_modules', '@nut-tree-fork', 'shared', 'dist', 'lib', 'button.enum.d.ts');
if (fs.existsSync(p)) {
  console.log(fs.readFileSync(p, 'utf8'));
} else {
  console.log('File not found:', p);
}
