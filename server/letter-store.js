import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export const DATA_DIR = resolve(process.env.LETTER_DATA_DIR || '.letter-data');
const bucket = process.env.SUPABASE_LETTER_BUCKET || 'letter-images';

export function sessionSecret() {
  const secret = process.env.LETTER_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.VERCEL || process.env.LETTER_STORE === 'supabase') throw new Error('请配置 LETTER_SESSION_SECRET（至少 32 个字符）。');
  mkdirSync(DATA_DIR, { recursive:true });
  const file = join(DATA_DIR, 'session-secret');
  try { return readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const value = randomBytes(48).toString('hex');
    try { writeFileSync(file, value, { flag:'wx', mode:0o600 }); return value; }
    catch (error) { if (error.code === 'EEXIST') return readFileSync(file, 'utf8'); throw error; }
  }
}

class LocalStore {
  static async create() {
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(DATA_DIR, 'uploads'), { recursive:true });
    const store = new LocalStore();
    store.db = new DatabaseSync(join(DATA_DIR, 'letter.sqlite'));
    store.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS letter_records (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS letter_feed ON letter_records(kind, created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS letter_limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL);`);
    return store;
  }
  row(row) { return row ? { ...row, data:JSON.parse(row.data) } : null; }
  insertRow(record) {
    const row = { id:randomUUID(), owner:'', text:'', data:{}, created_at:new Date().toISOString(), expires_at:null, ...record };
    this.db.prepare('INSERT INTO letter_records VALUES (?,?,?,?,?,?,?)').run(row.id,row.kind,row.owner,row.text,JSON.stringify(row.data),row.created_at,row.expires_at);
    return row;
  }
  async insert(record) { return this.insertRow(record); }
  async get(id) { return this.row(this.db.prepare('SELECT * FROM letter_records WHERE id=?').get(id)); }
  async list(kind, cursor, limit) {
    const rows = cursor
      ? this.db.prepare('SELECT * FROM letter_records WHERE kind=? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?').all(kind,cursor.date,cursor.date,cursor.id,limit)
      : this.db.prepare('SELECT * FROM letter_records WHERE kind=? ORDER BY created_at DESC,id DESC LIMIT ?').all(kind,limit);
    return rows.map(row=>this.row(row));
  }
  async rateLimit(key, limit, seconds) {
    const now = Date.now(), row = this.db.prepare('SELECT * FROM letter_limits WHERE key=?').get(key);
    const start = row && now-row.start < seconds*1000 ? row.start : now;
    const count = start===row?.start ? row.count+1 : 1;
    this.db.prepare('INSERT INTO letter_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET start=excluded.start,count=excluded.count').run(key,start,count);
    if(count===1)this.db.prepare('DELETE FROM letter_limits WHERE start < ?').run(now-86400000);
    return count<=limit;
  }
  async createComment(owner, text, imageIds, author) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const id of imageIds) {
        const row = this.row(this.db.prepare('SELECT * FROM letter_records WHERE id=?').get(id));
        if(!row || row.kind!=='attachment' || row.owner!==owner || row.data.attached)throw new Error('图片无效，请重新添加。');
      }
      const row = this.insertRow({ kind:'comment', owner, text, data:{imageIds,author} });
      for(const id of imageIds)this.db.prepare('UPDATE letter_records SET data=json_set(data,\'$.attached\',json(\'true\')) WHERE id=?').run(id);
      this.db.exec('COMMIT'); return row;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async deleteComment(authorId,id) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.row(this.db.prepare("SELECT * FROM letter_records WHERE id=? AND kind='comment'").get(id));
      if(!row)throw new Error('留言不存在');
      if((row.data.author?.id||'tanxiao')!==authorId)throw new Error('只能删除自己的留言');
      const keys=[];
      for(const imageId of row.data.imageIds||[]) {
        const image=this.row(this.db.prepare("SELECT * FROM letter_records WHERE id=? AND kind='attachment'").get(imageId));
        if(image&&image.owner===row.owner&&image.data.attached){keys.push(image.data.key);this.db.prepare('DELETE FROM letter_records WHERE id=?').run(imageId);}
      }
      this.db.prepare('DELETE FROM letter_records WHERE id=?').run(id);
      this.db.exec('COMMIT');return keys;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  async putObject(key, data) { await mkdir(join(DATA_DIR,'uploads'),{recursive:true}); await writeFile(join(DATA_DIR,'uploads',key),data,{flag:'wx'}); }
  async getObject(key) { return readFile(join(DATA_DIR,'uploads',key)); }
  async deleteObject(key) { await unlink(join(DATA_DIR,'uploads',key)).catch(()=>{}); }
}

class SupabaseStore {
  constructor() {
    this.url = process.env.SUPABASE_URL?.replace(/\/$/,'');
    this.key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!this.url || !this.key)throw new Error('请配置 Supabase 数据库和图片存储。');
    const parsed = new URL(this.url);
    if(parsed.protocol!=='https:')throw new Error('SUPABASE_URL 必须使用 HTTPS。');
  }
  async request(path, options={}) {
    const response = await fetch(this.url+path,{
      ...options, signal:AbortSignal.timeout(20000),
      headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,...options.headers},
    });
    if(!response.ok)throw new Error(`共享存储请求失败（${response.status}），请检查数据库迁移、权限和图片桶配置。`);
    return response;
  }
  async json(path, options={}) {
    const response = await this.request('/rest/v1/'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
    return response.status===204 ? null : response.json();
  }
  async insert(record) {
    const row = { id:randomUUID(), owner:'', text:'', data:{}, created_at:new Date().toISOString(), expires_at:null, ...record };
    await this.json('letter_records',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});return row;
  }
  async get(id) { return (await this.json(`letter_records?id=eq.${id}&limit=1`))[0] || null; }
  async list(kind,cursor,limit) {
    const query = new URLSearchParams({kind:`eq.${kind}`,order:'created_at.desc,id.desc',limit:String(limit)});
    if(cursor)query.set('or',`(created_at.lt.${cursor.date},and(created_at.eq.${cursor.date},id.lt.${cursor.id}))`);
    return this.json('letter_records?'+query);
  }
  async rateLimit(key,limit,seconds) { return this.json('rpc/letter_rate_limit',{method:'POST',body:JSON.stringify({p_key:key,p_limit:limit,p_seconds:seconds})}); }
  async createComment(owner,text,imageIds,author) { return this.json('rpc/letter_create_comment',{method:'POST',body:JSON.stringify({p_owner:owner,p_text:text,p_images:imageIds,p_author:author})}); }
  async deleteComment(authorId,id) { return this.json('rpc/letter_delete_comment',{method:'POST',body:JSON.stringify({p_author_id:authorId,p_id:id})}); }
  async putObject(key,data) { await this.request(`/storage/v1/object/${bucket}/${key}`,{method:'POST',headers:{'Content-Type':'image/jpeg','x-upsert':'false'},body:data}); }
  async getObject(key) { return Buffer.from(await (await this.request(`/storage/v1/object/${bucket}/${key}`)).arrayBuffer()); }
  async deleteObject(key) { await this.request(`/storage/v1/object/${bucket}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[key]})}).catch(()=>{}); }
}

let store;
export function getStore() {
  if(!store)store = process.env.VERCEL || process.env.LETTER_STORE==='supabase' || (process.env.LETTER_STORE!=='local' && process.env.SUPABASE_URL)
    ? Promise.resolve().then(()=>new SupabaseStore()) : LocalStore.create();
  return store;
}
