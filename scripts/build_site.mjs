import { mkdir, cp, rm } from 'node:fs/promises';

// 发布目录只包含网页资源，密码配置、数据库脚本和服务端源码不会作为静态文件发布。
await rm('public',{recursive:true,force:true});
await mkdir('public',{recursive:true});
for(const file of ['index.html','letter.html'])await cp(file,'public/'+file);
for(const folder of ['assets','photo'])await cp(folder,'public/'+folder,{recursive:true});
console.log('静态发布目录已生成：public/。私有配置留在服务端函数中。');
