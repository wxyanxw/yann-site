// 扫描 photo/ 目录，生成 photo/manifest.js（记录所有照片文件名）。
// 每次往 photo/ 增减照片后，运行一次：node gen_photos.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'photo');
const exts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.avif']);

const files = fs.readdirSync(dir)
  .filter(f => exts.has(path.extname(f).toLowerCase()))
  .sort();

const out = 'window.PHOTO_LIST = ' + JSON.stringify(files, null, 0) + ';\n';
fs.writeFileSync(path.join(dir, 'manifest.js'), out, 'utf8');

console.log('已写入 ' + files.length + ' 张照片到 photo/manifest.js');
