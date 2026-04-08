const express=require("express"),cors=require("cors"),cron=require("node-cron"),Database=require("better-sqlite3"),axios=require("axios");require("dotenv").config();const app=express(),PORT=process.env.PORT||3000;app.use(cors());app.use(express.json());

const db=new Database("reminders.db");
db.exec(`CREATE TABLE IF NOT EXISTS reminders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  nextDate TEXT NOT NULL,
  productDays INTEGER NOT NULL,
  productName TEXT DEFAULT '',
  notified INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT(datetime('now','+8 hours'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS registrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  productName TEXT NOT NULL,
  productCode TEXT NOT NULL,
  purchaseDate TEXT NOT NULL,
  purchasePlace TEXT NOT NULL,
  warrantyEnd TEXT NOT NULL,
  createdAt TEXT DEFAULT(datetime('now','+8 hours'))
)`);
try{db.exec("ALTER TABLE reminders ADD COLUMN productName TEXT DEFAULT ''")}catch(e){}
console.log("DB ready");

app.get("/",(req,res)=>res.json({status:"ok"}));

// 濾心提醒 API
app.post("/api/reminder",(req,res)=>{
  const{userId,nextDate,productDays,productName}=req.body;
  if(!userId||!nextDate||!productDays)return res.status(400).json({error:"missing fields"});
  try{
    const e=db.prepare("SELECT id FROM reminders WHERE userId=?").get(userId);
    const name=productName||"";
    e?db.prepare("UPDATE reminders SET nextDate=?,productDays=?,productName=?,notified=0 WHERE userId=?").run(nextDate,productDays,name,userId)
     :db.prepare("INSERT INTO reminders(userId,nextDate,productDays,productName)VALUES(?,?,?,?)").run(userId,nextDate,productDays,name);
    res.json({success:true});
  }catch(e){res.status(500).json({error:"server error"})}
});

// 產品登錄 API
app.post("/api/register",(req,res)=>{
  const{userId,productName,productCode,purchaseDate,purchasePlace}=req.body;
  if(!userId||!productName||!productCode||!purchaseDate||!purchasePlace)return res.status(400).json({error:"missing fields"});
  try{
    // 保固期 1 年
    const d=new Date(purchaseDate);
    d.setFullYear(d.getFullYear()+1);
    const warrantyEnd=d.toISOString().split("T")[0];
    db.prepare("INSERT INTO registrations(userId,productName,productCode,purchaseDate,purchasePlace,warrantyEnd)VALUES(?,?,?,?,?,?)").run(userId,productName,productCode,purchaseDate,purchasePlace,warrantyEnd);
    res.json({success:true,warrantyEnd});
  }catch(e){res.status(500).json({error:"server error"})}
});

app.get("/api/reminders",(req,res)=>res.json(db.prepare("SELECT * FROM reminders ORDER BY nextDate").all()));
app.get("/api/registrations",(req,res)=>res.json(db.prepare("SELECT * FROM registrations ORDER BY createdAt DESC").all()));

// LINE Token
const LINE_CHANNEL_ID=process.env.LINE_CHANNEL_ID,LINE_CHANNEL_SECRET=process.env.LINE_CHANNEL_SECRET,LINE_API="https://api.line.me/v2/bot/message/push";
async function getLineToken(){const r=await axios.post("https://api.line.me/oauth2/v3/token",`grant_type=client_credentials&client_id=${LINE_CHANNEL_ID}&client_secret=${LINE_CHANNEL_SECRET}`,{headers:{"Content-Type":"application/x-www-form-urlencoded"}});return r.data.access_token;}
async function sendMsg(userId,msg){try{const t=await getLineToken();await axios.post(LINE_API,{to:userId,messages:[{type:"text",text:msg}]},{headers:{"Content-Type":"application/json","Authorization":`Bearer ${t}`}});console.log("sent:"+userId);}catch(e){console.error(e.response?.data||e.message)}}

function daysDiff(d){const t=new Date,g=new Date(d);t.setHours(0,0,0,0);g.setHours(0,0,0,0);return Math.round((g-t)/86400000)}

// 每天早上 9:00 濾心提醒
cron.schedule("0 9 * * *",async()=>{
  const rs=db.prepare("SELECT * FROM reminders WHERE notified=0").all();
  for(const r of rs){
    const d=daysDiff(r.nextDate);
    const pName=r.productName||"濾心";
    if(d===3)await sendMsg(r.userId,`⏰ 【三菱可菱水 濾心更換提醒】\n\n濾心型號：${pName}\n到期日：${r.nextDate}（還有3天）\n\n請準備好新濾心，確保飲水健康！💧`);
    if(d===0){await sendMsg(r.userId,`🚨 【今天請更換濾心！】\n\n濾心型號：${pName}\n\n今天是您的濾心到期日，請立即換上新濾心！\n換完後請重新開啟提醒設定。💧`);db.prepare("UPDATE reminders SET notified=1 WHERE id=?").run(r.id);}
    if(d===-1){await sendMsg(r.userId,`⚠️ 您的【${pName}】濾心已逾期，請儘快更換！\n換完後記得重新設定提醒。`);db.prepare("UPDATE reminders SET notified=1 WHERE id=?").run(r.id);}
  }
},{timezone:"Asia/Taipei"});

// 每天早上 9:05 保固到期提醒
cron.schedule("5 9 * * *",async()=>{
  const regs=db.prepare("SELECT * FROM registrations").all();
  for(const r of regs){
    const d=daysDiff(r.warrantyEnd);
    if(d===30)await sendMsg(r.userId,`🔔 【保固即將到期提醒】\n\n產品：${r.productName}（${r.productCode}）\n保固到期日：${r.warrantyEnd}（剩30天）\n\n如有任何問題請儘快聯繫服務中心！`);
    if(d===7)await sendMsg(r.userId,`⚠️ 【保固剩餘7天】\n\n產品：${r.productName}（${r.productCode}）\n保固到期日：${r.warrantyEnd}\n\n請把握保固期間，如有需要請儘速聯繫！`);
  }
},{timezone:"Asia/Taipei"});

app.listen(PORT,()=>console.log("Server on port "+PORT));
